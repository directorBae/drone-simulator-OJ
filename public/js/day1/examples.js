// 1일차 예제 / 테스트 코드  (drones: 이 예제에 필요한 드론 대수)
export const EXAMPLES = [
  {
    title: '00. 슬라이드 시작 코드 (완성본)',
    drones: 1,
    code: String.raw`from pymavlink import mavutil; import time
L = mavutil.mavlink
m = connect()                       # 실습 환경이 제공하는 연결 (= mavutil.mavlink_connection(...))
m.wait_heartbeat(); s, c = m.target_system, m.target_component
print("연결됨! SYSID =", s)

def cmd(id, *p):                    # COMMAND_LONG, 파라미터 7개
    m.mav.command_long_send(s, c, id, 0, *(list(p) + [0] * (7 - len(p))))

def goto(x, y, z):                  # NED, z = -고도
    m.mav.set_position_target_local_ned_send(0, s, c, L.MAV_FRAME_LOCAL_NED,
        0b110111111000, x, y, z, 0, 0, 0, 0, 0, 0, 0, 0)   # 위치만 사용

m.set_mode('GUIDED')                # 모드 변경: 이 시뮬레이터는 ArduPilot(ArduCopter) 처럼 GUIDED
cmd(L.MAV_CMD_COMPONENT_ARM_DISARM, 1)          # 시동
cmd(L.MAV_CMD_NAV_TAKEOFF, 0, 0, 0, 0, 0, 0, 5) # 5 m 이륙
time.sleep(4)
for x, y in [(10, 0), (10, 10), (0, 10), (0, 0)]:
    print("이동:", x, y)
    goto(x, y, -5); time.sleep(5)
cmd(L.MAV_CMD_NAV_LAND)             # 착륙
print("착륙 명령 보냄")
`,
  },
  {
    title: '01. 연결하고 HEARTBEAT 받기',
    drones: 1,
    code: String.raw`# 체크포인트 1: HEARTBEAT 수신, 내 SYSID 확인
from pymavlink import mavutil

m = connect()            # = mavutil.mavlink_connection('udpin:0.0.0.0:14550')
hb = m.wait_heartbeat()
print("받은 메시지:", hb)
print("드론 SYSID =", hb.get_srcSystem(), "/ COMPID =", hb.get_srcComponent())
print("autopilot =", hb.autopilot, "(3 = ArduPilot)")
print("비행 모드 =", m.flightmode)

for i in range(3):       # HEARTBEAT 는 1초에 한 번
    hb = m.recv_match(type='HEARTBEAT', blocking=True)
    print(i + 1, "base_mode =", hb.base_mode, "custom_mode =", hb.custom_mode)
`,
  },
  {
    title: '02. 시동 + 이륙 + COMMAND_ACK 확인',
    drones: 1,
    code: String.raw`# 체크포인트 2: 시동 후 고도 5 m, COMMAND_ACK 확인
from pymavlink import mavutil
import time

L = mavutil.mavlink
m = connect()
m.wait_heartbeat()
s, c = m.target_system, m.target_component

def wait_ack(command, timeout=3):
    while True:
        ack = m.recv_match(type='COMMAND_ACK', blocking=True, timeout=timeout)
        if ack is None:
            print("  ACK 없음!"); return None
        if ack.command == command:       # 다른 명령의 ACK 는 건너뜀
            print("  ACK", command, "→", L.enums['MAV_RESULT'][ack.result].name)
            return ack.result

m.set_mode('GUIDED');                                   wait_ack(L.MAVLINK_MSG_ID_SET_MODE)
m.mav.command_long_send(s, c, L.MAV_CMD_COMPONENT_ARM_DISARM, 0, 1, 0, 0, 0, 0, 0, 0)
wait_ack(L.MAV_CMD_COMPONENT_ARM_DISARM)
m.mav.command_long_send(s, c, L.MAV_CMD_NAV_TAKEOFF, 0, 0, 0, 0, 0, 0, 0, 5)
wait_ack(L.MAV_CMD_NAV_TAKEOFF)

while True:
    pos = m.recv_match(type='LOCAL_POSITION_NED', blocking=True)
    print("고도 %.2f m" % -pos.z)
    if -pos.z > 4.8:
        break
print("이륙 완료!")
`,
  },
  {
    title: '03. 정사각형 비행 + 도착 판정 + 착륙',
    drones: 1,
    code: String.raw`# 체크포인트 3·4 (+ 보너스: sleep 대신 LOCAL_POSITION_NED 로 도착 판정)
from pymavlink import mavutil
import math

L = mavutil.mavlink
m = connect()
m.wait_heartbeat()
s, c = m.target_system, m.target_component

def cmd(id, *p):
    m.mav.command_long_send(s, c, id, 0, *(list(p) + [0] * (7 - len(p))))

def goto(x, y, z, tol=0.4):
    m.mav.set_position_target_local_ned_send(0, s, c, L.MAV_FRAME_LOCAL_NED,
        0b110111111000, x, y, z, 0, 0, 0, 0, 0, 0, 0, 0)
    while True:
        p = m.recv_match(type='LOCAL_POSITION_NED', blocking=True)
        if math.dist((p.x, p.y, p.z), (x, y, z)) < tol:
            print("도착 (%.1f, %.1f, 고도 %.1f)" % (p.x, p.y, -p.z))
            return

m.set_mode('GUIDED')
cmd(L.MAV_CMD_COMPONENT_ARM_DISARM, 1)
cmd(L.MAV_CMD_NAV_TAKEOFF, 0, 0, 0, 0, 0, 0, 5)
goto(0, 0, -5)
for x, y in [(10, 0), (10, 10), (0, 10), (0, 0)]:
    goto(x, y, -5)

cmd(L.MAV_CMD_NAV_LAND)
while True:
    p = m.recv_match(type='LOCAL_POSITION_NED', blocking=True)
    if -p.z < 0.05:
        break
m.motors_disarmed_wait()
print("착륙 완료: 고도 0, 시동 꺼짐")
`,
  },
  {
    title: '04. LED 켜기 · 색 바꾸기 · 깜빡이기',
    drones: 1,
    code: String.raw`# LED 제어: LED_CONTROL(186) 과 MAV_CMD_DO_SET_RELAY / DO_REPEAT_RELAY
from pymavlink import mavutil
import time

L = mavutil.mavlink
m = connect()
m.wait_heartbeat()
s, c = m.target_system, m.target_component

def led(r, g, b, blink_hz=0):
    """custom_len=3 → 단색, custom_len=4 → 4번째 바이트가 깜빡임 주파수(Hz)"""
    data = [r, g, b] + ([blink_hz] if blink_hz else [])
    m.mav.led_control_send(s, c, 42, 42, len(data), data + [0] * (24 - len(data)))

for name, rgb in [("빨강", (255, 0, 0)), ("초록", (0, 255, 0)), ("파랑", (0, 80, 255))]:
    print("LED:", name)
    led(*rgb)
    time.sleep(1)

print("노랑으로 초당 3번 깜빡이기")
led(255, 200, 0, blink_hz=3)
time.sleep(3)

print("LED 끄고, 릴레이 명령으로 5번 깜빡이기")
m.mav.led_control_send(s, c, 42, 0, 0, [0] * 24)       # pattern 0 = 끔
m.mav.command_long_send(s, c, L.MAV_CMD_DO_REPEAT_RELAY, 0,
                        0,      # param1: relay 번호 (0 = LED)
                        5,      # param2: 반복 횟수
                        0.6,    # param3: 주기(초)
                        0, 0, 0, 0)
time.sleep(3.5)
m.mav.command_long_send(s, c, L.MAV_CMD_DO_SET_RELAY, 0, 0, 1, 0, 0, 0, 0, 0)  # 켜기
print("LED 켬 (DO_SET_RELAY)")
`,
  },
  {
    title: '05. 텔레메트리 읽기 (자세 · 위치 · 배터리)',
    drones: 1,
    code: String.raw`from pymavlink import mavutil
import math, time

m = connect()
m.wait_heartbeat()

t_end = time.time() + 5
while time.time() < t_end:
    msg = m.recv_match(type=['ATTITUDE', 'GLOBAL_POSITION_INT', 'SYS_STATUS'], blocking=True)
    t = msg.get_type()
    if t == 'ATTITUDE':
        print("자세  roll=%5.1f° pitch=%5.1f° yaw=%6.1f°" % tuple(math.degrees(a) for a in (msg.roll, msg.pitch, msg.yaw)))
    elif t == 'GLOBAL_POSITION_INT':
        print("위치  lat=%.7f lon=%.7f 고도=%.2fm" % (msg.lat / 1e7, msg.lon / 1e7, msg.relative_alt / 1000))
    else:
        print("배터리 %d%% %.2fV" % (msg.battery_remaining, msg.voltage_battery / 1000))

print("받은 메시지 종류:", sorted(k for k in m.messages if k != 'MAV'))
`,
  },
  {
    title: '06. [보너스] 3D 나선 비행',
    drones: 1,
    code: String.raw`from pymavlink import mavutil
import math, time

L = mavutil.mavlink
m = connect()
m.wait_heartbeat()
s, c = m.target_system, m.target_component
m.set_mode('GUIDED')
m.arducopter_arm()
m.mav.command_long_send(s, c, L.MAV_CMD_NAV_TAKEOFF, 0, 0, 0, 0, 0, 0, 0, 3)
time.sleep(3)

R, turns, top = 5, 2, 15          # 반지름, 바퀴 수, 최종 고도
N = 60
for i in range(N + 1):
    th = 2 * math.pi * turns * i / N
    x, y, alt = R * math.cos(th) - R, R * math.sin(th), 3 + (top - 3) * i / N
    m.mav.set_position_target_local_ned_send(0, s, c, L.MAV_FRAME_LOCAL_NED,
        0b110111111000, x, y, -alt, 0, 0, 0, 0, 0, 0, 0, 0)
    time.sleep(0.35)
print("나선 완료 → RTL")
m.set_mode('RTL')
`,
  },
  {
    title: '07. [보너스] 기체 2대 동시 제어',
    drones: 2,
    code: String.raw`# 드론 2대 (SYSID 1, 2). 같은 링크로 target_system 만 바꿔 보냅니다.
from pymavlink import mavutil
import time

L = mavutil.mavlink
m = connect()
m.wait_heartbeat()

ids = set()
while len(ids) < 2:                       # 두 드론의 HEARTBEAT 확인
    hb = m.recv_match(type='HEARTBEAT', blocking=True)
    ids.add(hb.get_srcSystem())
print("발견한 드론:", sorted(ids))

class Drone:
    def __init__(self, sysid):
        self.id = sysid
    def cmd(self, command, *p):
        m.mav.command_long_send(self.id, 1, command, 0, *(list(p) + [0] * (7 - len(p))))
    def mode(self, name):
        m.mav.set_mode_send(self.id, L.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED, m.mode_mapping()[name])
    def goto(self, x, y, alt):
        m.mav.set_position_target_local_ned_send(0, self.id, 1, L.MAV_FRAME_LOCAL_NED,
            0b110111111000, x, y, -alt, 0, 0, 0, 0, 0, 0, 0, 0)
    def led(self, r, g, b):
        m.mav.led_control_send(self.id, 1, 42, 42, 3, [r, g, b] + [0] * 21)

drones = [Drone(i) for i in sorted(ids)]
for d, alt, rgb in zip(drones, [5, 8], [(255, 60, 60), (60, 160, 255)]):
    d.mode('GUIDED'); d.cmd(L.MAV_CMD_COMPONENT_ARM_DISARM, 1)
    d.cmd(L.MAV_CMD_NAV_TAKEOFF, 0, 0, 0, 0, 0, 0, alt); d.led(*rgb)
time.sleep(5)

# 각 드론의 로컬 좌표 원점은 자기 출발점입니다 (드론 2는 동쪽 3 m 에서 출발)
for step in range(4):
    for k, d in enumerate(drones):
        x, y = [(8, 0), (8, 8), (0, 8), (0, 0)][(step + 2 * k) % 4]
        d.goto(x, y, 5 + 3 * k)
    time.sleep(5)
for d in drones:
    d.cmd(L.MAV_CMD_NAV_LAND)
print("두 대 모두 착륙 명령")
`,
  },
  {
    title: '08. 바이트로 MAVLink 프레임 직접 만들기',
    drones: 1,
    code: String.raw`# MAVLink 2 프레임: STX | LEN | INC | CMP | SEQ | SYSID | COMPID | MSGID(3) | PAYLOAD | CRC(2)
from pymavlink import mavutil
import struct

m = connect()
m.wait_heartbeat()

def crc_x25(data, crc=0xFFFF):
    for b in data:
        tmp = b ^ (crc & 0xFF)
        tmp = (tmp ^ (tmp << 4)) & 0xFF
        crc = ((crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xFFFF
    return crc

def frame(msgid, crc_extra, payload, seq=0):
    header = bytes([0xFD, len(payload), 0, 0, seq, 255, 190]) + msgid.to_bytes(3, 'little')
    crc = crc_x25(bytes([crc_extra]), crc_x25(header[1:] + payload))
    return header + payload + crc.to_bytes(2, 'little')

# SET_MODE(11, CRC_EXTRA 89): custom_mode(uint32), target_system(uint8), base_mode(uint8)
f = frame(11, 89, struct.pack('<IBB', 4, m.target_system, 1))
print("직접 만든 SET_MODE :", f.hex(' '))
print("라이브러리 결과    :", m.mav.set_mode_encode(m.target_system, 1, 4).pack(m.mav).hex(' '))
m.write(f)

# 일부러 CRC 를 틀리게 보내 보기 → 시뮬레이터가 '잘못된 메시지'로 알려줍니다
bad = bytearray(f); bad[-1] ^= 0xFF
m.write(bytes(bad))

ack = m.recv_match(type='COMMAND_ACK', blocking=True, timeout=3)
print("응답:", ack)
`,
  },
];
