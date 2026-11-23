"""
pymavlink.mavutil 호환 (시뮬레이터 전용)

    from pymavlink import mavutil
    master = mavutil.mavlink_connection('udpin:0.0.0.0:14550')
    master.wait_heartbeat()

연결 문자열은 실제 드론/SITL 용 그대로 써도 되며, 시뮬레이터에서는 항상 가상 드론에 연결됩니다.
"""
import sys
import time
from collections import deque

from . import mavlink

try:
    from js import simBridge
except ImportError:  # 로컬 테스트용 더미
    simBridge = None

mode_mapping_acm = {
    "STABILIZE": 0, "ACRO": 1, "ALT_HOLD": 2, "AUTO": 3, "GUIDED": 4, "LOITER": 5, "RTL": 6, "CIRCLE": 7,
    "POSITION": 8, "LAND": 9, "OF_LOITER": 10, "DRIFT": 11, "SPORT": 13, "FLIP": 14, "AUTOTUNE": 15,
    "POSHOLD": 16, "BRAKE": 17, "THROW": 18, "AVOID_ADSB": 19, "GUIDED_NOGPS": 20, "SMART_RTL": 21,
}
_mode_names_acm = {v: k for k, v in mode_mapping_acm.items()}


def mode_string_v10(msg):
    if msg.get_type() != "HEARTBEAT":
        return "UNKNOWN"
    if msg.autopilot == mavlink.MAV_AUTOPILOT_ARDUPILOTMEGA and msg.custom_mode in _mode_names_acm:
        return _mode_names_acm[msg.custom_mode]
    return "Mode(%d)" % msg.custom_mode


def evaluate_condition(condition, vars):
    if condition is None:
        return True
    try:
        return bool(eval(condition, {}, vars))
    except Exception:
        return False


class periodic_event:
    def __init__(self, frequency):
        self.frequency = float(frequency)
        self.last_time = time.time()

    def force(self):
        self.last_time = 0

    def trigger(self):
        now = time.time()
        if now - self.last_time >= 1.0 / self.frequency:
            self.last_time = now
            return True
        return False


class location:
    def __init__(self, lat, lng, alt=0, heading=0):
        self.lat, self.lng, self.alt, self.heading = lat, lng, alt, heading

    def __str__(self):
        return "lat=%.7f,lon=%.7f,alt=%.2f" % (self.lat, self.lng, self.alt)


class mavfile:
    """mavutil.mavlink_connection() 이 돌려주는 연결 객체 (흔히 master 라고 부름)"""

    def __init__(self, device, source_system=255, source_component=0):
        self.address = device
        self.source_system = source_system
        self.source_component = source_component
        self.mav = mavlink.MAVLink(self, srcSystem=source_system, srcComponent=source_component)
        self.target_system = 0
        self.target_component = 0
        self.messages = {"MAV": self}
        self.flightmode = "UNKNOWN"
        self.base_mode = 0
        self.mav_type = None
        self.mav_count = 0
        self.timestamp = 0
        self._parser = mavlink.Parser()
        self._queue = deque(maxlen=2000)
        self._warned_types = set()
        if simBridge is not None:
            simBridge.connect(str(device))

    # ---- 저수준 I/O
    def write(self, buf):
        """바이트를 그대로 드론에게 보냅니다 (직접 만든 MAVLink 프레임 전송용)"""
        if isinstance(buf, str):
            buf = buf.encode("latin-1")
        simBridge.write(bytes(buf).hex())

    def _pump(self):
        h = simBridge.read()
        if h:
            for m in self._parser.parse(bytes.fromhex(str(h))):
                self._post_message(m)
                self._queue.append(m)

    def _post_message(self, m):
        t = m.get_type()
        self.messages[t] = m
        self.mav_count += 1
        self.timestamp = time.time()
        m._timestamp = self.timestamp
        if t == "HEARTBEAT" and m.type != mavlink.MAV_TYPE_GCS:
            if self.target_system == 0:
                self.target_system = m.get_srcSystem()
                self.target_component = m.get_srcComponent()
            if m.get_srcSystem() == self.target_system:
                self.flightmode = mode_string_v10(m)
                self.base_mode = m.base_mode
                self.mav_type = m.type

    # ---- 수신
    def recv_msg(self):
        """받은 메시지 하나를 돌려줍니다. 없으면 None (기다리지 않음)"""
        if not self._queue:
            self._pump()
        return self._queue.popleft() if self._queue else None

    def recv_match(self, condition=None, type=None, blocking=False, timeout=None):
        """조건에 맞는 메시지를 받을 때까지 읽습니다. 맞지 않는 메시지는 버려집니다.

        type     : 'HEARTBEAT' 또는 ['ATTITUDE', 'VFR_HUD'] 처럼 메시지 이름
        blocking : True 면 메시지가 올 때까지 기다림
        timeout  : 초. 시간 안에 못 받으면 None
        """
        if isinstance(type, str):
            type = [type]
        if type:
            for t in type:
                if t not in mavlink.MSG_BY_NAME and t not in self._warned_types:
                    self._warned_types.add(t)
                    print("[경고] '%s' 는 이 시뮬레이터 드론이 보내지 않는 메시지입니다. "
                          "blocking=True 이면 계속 기다리게 됩니다." % t, file=sys.stderr)
        start = time.time()
        while True:
            m = self.recv_msg()
            if m is None:
                if not blocking:
                    return None
                if timeout is not None and time.time() - start >= timeout:
                    return None
                time.sleep(0.005)
                continue
            if type and m.get_type() not in type:
                continue
            if not evaluate_condition(condition, self.messages):
                continue
            return m

    def wait_heartbeat(self, blocking=True, timeout=None):
        return self.recv_match(type="HEARTBEAT", blocking=blocking, timeout=timeout)

    # ---- 편의 함수 (ArduPilot)
    def mode_mapping(self):
        return dict(mode_mapping_acm)

    def set_mode(self, mode, custom_mode=0, custom_sub_mode=0):
        """비행 모드 변경: master.set_mode('GUIDED')  (SET_MODE 메시지 전송)"""
        if isinstance(mode, str):
            key = mode.upper()
            if key not in mode_mapping_acm:
                raise ValueError("알 수 없는 모드 '%s'. 가능한 모드: %s" % (mode, ", ".join(mode_mapping_acm)))
            mode_id = mode_mapping_acm[key]
        else:
            mode_id = int(mode)
        self.mav.set_mode_send(self.target_system, mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED, mode_id)

    set_mode_apm = set_mode

    def set_mode_rtl(self):
        self.set_mode("RTL")

    def set_mode_loiter(self):
        self.set_mode("LOITER")

    def arducopter_arm(self):
        self.mav.command_long_send(self.target_system, self.target_component,
                                   mavlink.MAV_CMD_COMPONENT_ARM_DISARM, 0, 1, 0, 0, 0, 0, 0, 0)

    def arducopter_disarm(self):
        self.mav.command_long_send(self.target_system, self.target_component,
                                   mavlink.MAV_CMD_COMPONENT_ARM_DISARM, 0, 0, 0, 0, 0, 0, 0, 0)

    def motors_armed(self):
        return bool(self.base_mode & mavlink.MAV_MODE_FLAG_SAFETY_ARMED)

    def motors_armed_wait(self):
        while True:
            self.wait_heartbeat()
            if self.motors_armed():
                return

    def motors_disarmed_wait(self):
        while True:
            self.wait_heartbeat()
            if not self.motors_armed():
                return

    def location(self, relative_alt=False):
        m = self.recv_match(type="GLOBAL_POSITION_INT", blocking=True)
        alt = m.relative_alt if relative_alt else m.alt
        return location(m.lat * 1e-7, m.lon * 1e-7, alt * 1e-3, m.hdg * 0.01)

    def close(self):
        pass


def mavlink_connection(device, baud=115200, source_system=255, source_component=0, **kwargs):
    """드론과 연결합니다. (시뮬레이터에서는 주소와 상관없이 가상 드론에 연결)"""
    return mavfile(device, source_system=source_system, source_component=source_component)
