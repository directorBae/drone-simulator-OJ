// 1일차 예제 / 테스트 코드  (drones: 이 예제에 필요한 드론 대수)
// 미션 정답(해설)은 여기 두지 않습니다 → server/day1-solutions.js (관리자가 공개하면 /api/day1/solutions 로 내려옴)
export const EXAMPLES = [
  {
    title: "00. 시작 코드 (빈칸 채우기)",
    drones: 1,
    code: String.raw`# 미션: 연결 → 이륙(5 m) → 한 변 10 m 정사각형 → 착륙.  # TODO 를 채워 보세요
from pymavlink import mavutil; import time
L = mavutil.mavlink
m = connect()                       # 실습 환경이 제공하는 연결 (= mavutil.mavlink_connection(...))
m.wait_heartbeat(); s, c = m.target_system, m.target_component
print("연결됨! SYSID =", s)

def cmd(id, *p):                    # COMMAND_LONG, 파라미터 7개 (모자라면 0 으로 채움)
    m.mav.command_long_send(s, c, id, 0, *(list(p) + [0] * (7 - len(p))))

def goto(x, y, z):                  # NED 좌표, z = -고도
    m.mav.set_position_target_local_ned_send(0, s, c, L.MAV_FRAME_LOCAL_NED,
        0b110111111000, x, y, z, 0, 0, 0, 0, 0, 0, 0, 0)   # 위치만 사용

# TODO 1. 비행 모드를 GUIDED 로 바꾸기
# TODO 2. 시동 걸기            (MAV_CMD_COMPONENT_ARM_DISARM)
# TODO 3. 5 m 이륙             (MAV_CMD_NAV_TAKEOFF — 고도는 7번째 파라미터)
# TODO 4. 정사각형 비행         (10,0) → (10,10) → (0,10) → (0,0), 고도 5 m  — 움직일 시간은 time.sleep() 으로
# TODO 5. 착륙                 (MAV_CMD_NAV_LAND)
`,
  },
  {
    title: "01. 연결하고 HEARTBEAT 받기",
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
    title: "02. 텔레메트리 읽기 (자세 · 위치 · 배터리)",
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
    title: "03. 바이트로 MAVLink 프레임 직접 만들기",
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
