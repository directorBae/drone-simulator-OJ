// 1일차 해설(정답) 예제 — public/ 밖에 두어 학생이 볼 수 없음.
// 관리자 페이지에서 '1일차 해설 공개'를 켜면 GET /api/day1/solutions 로 내려가 1일차 예제 목록에 나타납니다.
export const DAY1_SOLUTIONS = [
  {
    title: "📗 해설 · 정사각형 미션 완성본 (슬라이드 코드)",
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
    title: "📗 해설 · 시동 + 이륙 + COMMAND_ACK 확인",
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
    title: "📗 해설 · 정사각형 비행 + 도착 판정 + 착륙",
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
    title: "📗 해설 · LED 켜기 · 색 바꾸기 · 깜빡이기",
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
    title: "📗 해설 · [보너스] 3D 나선 비행",
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
    title: "📗 해설 · [보너스] 기체 2대 동시 제어",
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
];
