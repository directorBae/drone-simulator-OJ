// 1일차 MAVLink 사전: 미션에 필요한 메시지·명령·값과 그 밖의 메시지를 찾아보는 탭
// 필드 이름·타입·순서·메시지 ID·CRC_EXTRA 는 시뮬레이터 코덱(js/core/mavlink.js)에서 그대로 읽어 옴
import { esc, hexHtml, HEX_LEGEND } from '../core/ui.js';

const ML = window.MAVLink;

// ---------------------------------------------------------------------- 메시지
// dir: 'down' = 드론 → 내 코드 (받는 메시지), 'up' = 내 코드 → 드론 (보내는 메시지), 'both'
const MESSAGES = [
  {
    name: 'HEARTBEAT', core: true, dir: 'both', rate: '1 Hz',
    summary: '"나 살아 있어요" 신호. 드론이 1초마다 보내며, 연결되었는지·어떤 모드인지·시동이 걸렸는지 알려 줍니다. 받은 HEARTBEAT 의 보낸 쪽 번호가 드론의 SYSID 입니다.',
    fields: {
      type: '기체 종류 (MAV_TYPE). 2 = 쿼드콥터, 6 = 지상국',
      autopilot: '오토파일럿 종류 (MAV_AUTOPILOT). 3 = ArduPilot',
      base_mode: '모드 플래그 비트 (MAV_MODE_FLAG). 128 이 켜져 있으면 시동(ARM) 상태, 1 = custom_mode 사용',
      custom_mode: '현재 비행 모드 번호 (아래 "비행 모드" 표). 4 = GUIDED',
      system_status: '상태 (MAV_STATE). 3 = 대기, 4 = 비행 중, 5 = 위험',
      mavlink_version: 'MAVLink 버전 (3)',
    },
    recv: `hb = m.wait_heartbeat()                 # 첫 HEARTBEAT 를 받을 때까지 기다림
print(hb.get_srcSystem())               # 보낸 드론의 SYSID
print(m.target_system, m.target_component)  # wait_heartbeat() 뒤 자동으로 채워짐
print(m.flightmode, m.motors_armed())   # 모드 이름, 시동 여부`,
    tips: ['명령을 보낼 때 target_system 에는 이 SYSID 를 넣어야 드론이 반응합니다.', '드론이 여러 대면 SYSID 가 1, 2, 3 … 으로 다릅니다.'],
  },
  {
    name: 'SET_MODE', core: true, dir: 'up',
    summary: '비행 모드를 바꿉니다. 코드로 움직이려면 GUIDED(4) 모드여야 합니다. pymavlink 의 m.set_mode(이름) 이 이 메시지를 대신 만들어 줍니다.',
    fields: {
      target_system: '받을 드론의 SYSID',
      base_mode: '1 (MAV_MODE_FLAG_CUSTOM_MODE_ENABLED) — custom_mode 를 쓰겠다는 뜻',
      custom_mode: '바꿀 모드 번호 (아래 "비행 모드" 표)',
    },
    tips: ['드론은 결과를 COMMAND_ACK (command = 11) 로 알려 줍니다.', '쉬운 방법: m.set_mode(\'GUIDED\')'],
  },
  {
    name: 'COMMAND_LONG', core: true, dir: 'up',
    summary: '"명령"을 보내는 만능 메시지. command 에 명령 번호(MAV_CMD)를 넣고, 명령마다 뜻이 다른 param1~param7 을 채웁니다. 시동·이륙·착륙·LED 등 대부분이 이 메시지입니다.',
    fields: {
      target_system: '받을 드론의 SYSID (m.target_system)',
      target_component: '받을 부품 번호. 오토파일럿 = 1 (m.target_component)',
      command: '명령 번호 (아래 "명령 (MAV_CMD)" 표). 예: mavutil.mavlink.MAV_CMD_NAV_TAKEOFF',
      confirmation: '같은 명령을 다시 보낼 때 늘리는 번호. 보통 0',
      param1: '명령마다 다름', param2: '명령마다 다름', param3: '명령마다 다름', param4: '명령마다 다름',
      param5: '명령마다 다름', param6: '명령마다 다름', param7: '명령마다 다름',
    },
    tips: ['param 은 7개를 모두 채워야 합니다. 안 쓰는 칸은 0.', '보낸 뒤 COMMAND_ACK 의 result 를 확인하면 드론이 받아들였는지 알 수 있습니다.'],
  },
  {
    name: 'COMMAND_ACK', core: true, dir: 'down',
    summary: 'COMMAND_LONG(또는 SET_MODE)에 대한 드론의 대답. 명령을 받아들였는지, 왜 거절했는지 알 수 있습니다.',
    fields: {
      command: '어떤 명령에 대한 대답인지 (MAV_CMD 번호, SET_MODE 는 11)',
      result: '결과 (MAV_RESULT). 0 = 수락, 4 = 실패 … 아래 표 참고',
    },
    recv: `ack = m.recv_match(type='COMMAND_ACK', blocking=True, timeout=3)
if ack:
    print(ack.command, mavutil.mavlink.enums['MAV_RESULT'][ack.result].name)`,
    tips: ['거절 이유는 콘솔의 회색 [sim] 로그에 한국어로 나옵니다.'],
  },
  {
    name: 'SET_POSITION_TARGET_LOCAL_NED', core: true, dir: 'up',
    summary: '"여기로 가라" 또는 "이 속도로 움직여라". 출발점 기준 NED 좌표(북·동·아래, m)로 목표를 줍니다. GUIDED 모드 + 이륙한 뒤에만 반응합니다.',
    fields: {
      time_boot_ms: '보낸 시각 (ms). 0 으로 두어도 됨',
      target_system: '받을 드론의 SYSID', target_component: '받을 부품 번호 (1)',
      coordinate_frame: '좌표계 (MAV_FRAME). 1 = LOCAL_NED (출발점 기준) · 아래 표 참고',
      type_mask: '쓰지 않을 값을 1 로 표시하는 비트 마스크. 위치만: 0b110111111000 · 아래 표 참고',
      x: '북쪽 (m)', y: '동쪽 (m)', z: '아래쪽 (m). 고도 5 m → z = −5',
      vx: '북쪽 속도 (m/s)', vy: '동쪽 속도 (m/s)', vz: '아래쪽 속도 (m/s)',
      afx: '가속도 (이 시뮬레이터는 무시)', afy: '가속도 (무시)', afz: '가속도 (무시)',
      yaw: '기수 방향 (rad)', yaw_rate: '기수 회전 속도 (rad/s)',
    },
    tips: ['NED 의 z 는 아래가 + 입니다. 하늘로 올라가려면 z 를 음수로!', '위치 명령은 계속 유지되지만, 속도 명령은 3초 동안 새로 오지 않으면 멈춥니다.', '목표에 도착했는지는 LOCAL_POSITION_NED 로 확인할 수 있습니다.'],
  },
  {
    name: 'LOCAL_POSITION_NED', core: true, dir: 'down', rate: '10 Hz',
    summary: '드론의 현재 위치와 속도. 원점은 드론의 출발점이고 단위는 m, m/s 입니다.',
    fields: {
      time_boot_ms: '드론이 켜진 뒤 시간 (ms)',
      x: '북쪽 (m)', y: '동쪽 (m)', z: '아래쪽 (m). 고도 = −z',
      vx: '북쪽 속도 (m/s)', vy: '동쪽 속도 (m/s)', vz: '아래쪽 속도 (m/s)',
    },
    recv: `p = m.recv_match(type='LOCAL_POSITION_NED', blocking=True)
print("북 %.1f 동 %.1f 고도 %.1f" % (p.x, p.y, -p.z))`,
    tips: ['"도착했나?" 판정: 목표와의 거리가 0.3~0.5 m 안이면 도착으로 보면 됩니다.'],
  },
  {
    name: 'STATUSTEXT', dir: 'down',
    summary: '드론이 보내는 짧은 글 메시지. "Arming motors" 처럼 상태 변화를 알려 줍니다.',
    fields: { severity: '중요도 (MAV_SEVERITY). 0 = 비상 … 6 = 정보', text: '내용 (최대 50자)' },
    recv: `st = m.recv_match(type='STATUSTEXT', blocking=True, timeout=5)
if st: print(st.severity, st.text)`,
  },
  {
    name: 'SYS_STATUS', dir: 'down', rate: '1 Hz',
    summary: '시스템 상태와 배터리.',
    fields: {
      onboard_control_sensors_present: '달려 있는 센서 (비트)', onboard_control_sensors_enabled: '켜진 센서 (비트)', onboard_control_sensors_health: '정상인 센서 (비트)',
      load: 'CPU 사용률 (0.1% 단위, 1000 = 100%)', voltage_battery: '배터리 전압 (mV)', current_battery: '전류 (10 mA 단위)',
      battery_remaining: '배터리 남은 양 (%)', drop_rate_comm: '통신 손실률', errors_comm: '통신 오류 수',
      errors_count1: '오류 카운터', errors_count2: '오류 카운터', errors_count3: '오류 카운터', errors_count4: '오류 카운터',
    },
    recv: `s = m.recv_match(type='SYS_STATUS', blocking=True)
print("배터리 %d%% %.2fV" % (s.battery_remaining, s.voltage_battery / 1000))`,
  },
  {
    name: 'ATTITUDE', dir: 'down', rate: '10 Hz',
    summary: '자세: 기울기(roll·pitch)와 기수 방향(yaw). 단위는 라디안.',
    fields: {
      time_boot_ms: '시간 (ms)', roll: '좌우 기울기 (rad)', pitch: '앞뒤 기울기 (rad)', yaw: '기수 방향 (rad, 북쪽 = 0, 시계 방향 +)',
      rollspeed: 'roll 각속도 (rad/s)', pitchspeed: 'pitch 각속도 (rad/s)', yawspeed: 'yaw 각속도 (rad/s)',
    },
    recv: `a = m.recv_match(type='ATTITUDE', blocking=True)
import math; print(math.degrees(a.yaw))`,
  },
  {
    name: 'GLOBAL_POSITION_INT', dir: 'down', rate: '5 Hz',
    summary: 'GPS 위치 (위도·경도·고도). 정수로 보내므로 단위 변환이 필요합니다. 홈은 세종대(37.5503, 127.0731).',
    fields: {
      time_boot_ms: '시간 (ms)', lat: '위도 × 10⁷ (정수)', lon: '경도 × 10⁷ (정수)', alt: '해발 고도 (mm)',
      relative_alt: '이륙 지점 기준 고도 (mm)', vx: '북쪽 속도 (cm/s)', vy: '동쪽 속도 (cm/s)', vz: '아래쪽 속도 (cm/s)', hdg: '기수 방향 (0.01° 단위)',
    },
    recv: `g = m.recv_match(type='GLOBAL_POSITION_INT', blocking=True)
print(g.lat / 1e7, g.lon / 1e7, g.relative_alt / 1000)`,
  },
  {
    name: 'VFR_HUD', dir: 'down', rate: '4 Hz',
    summary: '조종석 계기판 값: 속도, 방향, 고도, 상승률.',
    fields: { airspeed: '대기 속도 (m/s)', groundspeed: '지면 속도 (m/s)', heading: '방향 (°)', throttle: '스로틀 (%)', alt: '해발 고도 (m)', climb: '상승률 (m/s)' },
  },
  {
    name: 'SET_POSITION_TARGET_GLOBAL_INT', dir: 'up',
    summary: 'SET_POSITION_TARGET_LOCAL_NED 와 같지만 목표를 위도·경도로 줍니다.',
    fields: {
      time_boot_ms: '보낸 시각 (ms)', target_system: '드론 SYSID', target_component: '부품 번호 (1)',
      coordinate_frame: '좌표계. 6 = GLOBAL_RELATIVE_ALT_INT (고도는 이륙 지점 기준), 5 = GLOBAL_INT (해발)',
      type_mask: '쓰지 않을 값 비트 (LOCAL_NED 와 같음)', lat_int: '위도 × 10⁷ (정수)', lon_int: '경도 × 10⁷ (정수)', alt: '고도 (m)',
      vx: '북쪽 속도 (m/s)', vy: '동쪽 속도 (m/s)', vz: '아래쪽 속도 (m/s)', afx: '무시', afy: '무시', afz: '무시', yaw: '기수 방향 (rad)', yaw_rate: '회전 속도 (rad/s)',
    },
    tips: ['홈에서 2 km 넘게 떨어진 목표는 거부됩니다 (lat_int 에 10⁷ 을 곱했는지 확인).'],
  },
  {
    name: 'LED_CONTROL', dir: 'up', bonus: true,
    summary: '드론의 LED 색을 바꿉니다 (ArduPilot 확장 메시지).',
    fields: {
      target_system: '드론 SYSID', target_component: '부품 번호 (1)', instance: 'LED 번호. 42 = 전체',
      pattern: '42 = 사용자 지정 색, 0 = 끄기', custom_len: 'custom_bytes 중 쓸 개수. 3 = R,G,B · 4 = R,G,B,깜빡임 Hz',
      custom_bytes: '24바이트 배열. 앞에서부터 R, G, B (0~255), 4번째는 초당 깜빡임 횟수',
    },
    tips: ['custom_bytes 는 항상 24개를 채워 보내야 합니다: [255, 0, 0] + [0] * 21'],
  },
  {
    name: 'REQUEST_DATA_STREAM', dir: 'up',
    summary: '텔레메트리 묶음의 전송 주기를 바꾸는 옛 방식. 지금은 MAV_CMD_SET_MESSAGE_INTERVAL 을 더 많이 씁니다.',
    fields: {
      target_system: '드론 SYSID', target_component: '부품 번호 (1)', req_stream_id: '묶음 번호 (MAV_DATA_STREAM). 0 = 전부, 6 = 위치, 10 = 자세',
      req_message_rate: '초당 횟수 (Hz)', start_stop: '1 = 시작, 0 = 중지',
    },
  },
];

// ---------------------------------------------------------------------- COMMAND_LONG 명령
const COMMANDS = [
  { id: 400, name: 'MAV_CMD_COMPONENT_ARM_DISARM', core: true, summary: '시동 걸기 / 끄기', params: { 1: '1 = 시동(ARM), 0 = 끄기(DISARM)', 2: '21196 = 강제 (비행 중에도 끔 → 추락!)' },
    tips: ['GUIDED 등 시동 가능한 모드에서만 됩니다.', '시동 후 10초 안에 이륙하지 않으면 자동으로 꺼집니다.'] },
  { id: 22, name: 'MAV_CMD_NAV_TAKEOFF', core: true, summary: '이륙', params: { 7: '이륙 고도 (m, 양수)' },
    tips: ['GUIDED 모드 + 시동 상태에서만 됩니다.', '고도는 param7 (마지막 칸) 입니다.'] },
  { id: 21, name: 'MAV_CMD_NAV_LAND', core: true, summary: '그 자리에 착륙 (LAND 모드로 바뀜)', params: {}, tips: ['땅에 닿으면 자동으로 시동이 꺼집니다.'] },
  { id: 20, name: 'MAV_CMD_NAV_RETURN_TO_LAUNCH', summary: '출발점으로 돌아와 착륙 (RTL 모드)', params: {} },
  { id: 176, name: 'MAV_CMD_DO_SET_MODE', summary: 'COMMAND_LONG 으로 모드 바꾸기', params: { 1: '1 (MAV_MODE_FLAG_CUSTOM_MODE_ENABLED)', 2: '모드 번호 (4 = GUIDED)' } },
  { id: 178, name: 'MAV_CMD_DO_CHANGE_SPEED', summary: '수평 이동 속도 바꾸기', params: { 1: '속도 종류 (1 = 지면 속도)', 2: '속도 (m/s, 최대 15)', 3: '스로틀 (−1 = 그대로)' } },
  { id: 115, name: 'MAV_CMD_CONDITION_YAW', summary: '기수 방향 돌리기', params: { 1: '각도 (°)', 2: '회전 속도 (°/s)', 3: '방향: 1 = 시계, −1 = 반시계', 4: '0 = 절대 각도, 1 = 지금 방향에서 상대 각도' } },
  { id: 181, name: 'MAV_CMD_DO_SET_RELAY', bonus: true, summary: '릴레이 켜기/끄기 (이 드론은 릴레이 0 = LED)', params: { 1: '릴레이 번호 (0)', 2: '1 = 켜기, 0 = 끄기' } },
  { id: 182, name: 'MAV_CMD_DO_REPEAT_RELAY', bonus: true, summary: '릴레이 반복 깜빡이기', params: { 1: '릴레이 번호 (0)', 2: '횟수', 3: '주기 (초)' } },
  { id: 511, name: 'MAV_CMD_SET_MESSAGE_INTERVAL', summary: '특정 메시지의 전송 주기 바꾸기', params: { 1: '메시지 ID (예: 32 = LOCAL_POSITION_NED)', 2: '간격 (마이크로초). 50000 = 20 Hz, −1 = 끄기, 0 = 기본값' } },
  { id: 512, name: 'MAV_CMD_REQUEST_MESSAGE', summary: '특정 메시지를 지금 한 번 보내 달라고 요청', params: { 1: '메시지 ID' } },
];

// ---------------------------------------------------------------------- 값 표
const TABLES = [
  { id: 'modes', title: '비행 모드 (HEARTBEAT.custom_mode · SET_MODE)', core: true, head: ['번호', '이름', '뜻'], rows: [
    [0, 'STABILIZE', '수동 자세 유지. 시동 가능'], [2, 'ALT_HOLD', '고도 유지'], [4, 'GUIDED', '⭐ 코드로 위치·속도 명령을 받는 모드. 미션은 이 모드에서'],
    [5, 'LOITER', '그 자리 맴돌기'], [6, 'RTL', '출발점으로 돌아와 착륙'], [9, 'LAND', '그 자리에 착륙'], [16, 'POSHOLD', '위치 유지'], [17, 'BRAKE', '급정지'],
  ], note: 'pymavlink: m.set_mode(\'GUIDED\') · 현재 모드 이름: m.flightmode · 전체 표: m.mode_mapping()' },
  { id: 'result', title: '결과 (COMMAND_ACK.result · MAV_RESULT)', core: true, head: ['값', '이름', '뜻'], rows: [
    [0, 'ACCEPTED', '수락 — 실행함'], [1, 'TEMPORARILY_REJECTED', '지금은 안 됨 — 잠시 뒤 다시'], [2, 'DENIED', '거부 — 값이 잘못됨'],
    [3, 'UNSUPPORTED', '모르는 명령'], [4, 'FAILED', '실패 — 조건이 안 맞음 (모드·시동 등)'], [5, 'IN_PROGRESS', '진행 중'],
  ] },
  { id: 'frame', title: '좌표계 (coordinate_frame · MAV_FRAME)', core: true, head: ['값', '이름', '뜻'], rows: [
    [1, 'LOCAL_NED', '⭐ 출발점 기준 북·동·아래 (m)'], [7, 'LOCAL_OFFSET_NED', '지금 위치 기준 북·동·아래'],
    [8, 'BODY_NED', '기수 방향 기준 앞·오른쪽·아래 (원점은 출발점)'], [9, 'BODY_OFFSET_NED', '지금 위치 + 기수 방향 기준 앞·오른쪽·아래'],
    [5, 'GLOBAL_INT', '위도·경도, 고도는 해발 (GLOBAL_INT 메시지용)'], [6, 'GLOBAL_RELATIVE_ALT_INT', '위도·경도, 고도는 이륙 지점 기준'],
  ] },
  { id: 'mask', title: 'type_mask (SET_POSITION_TARGET_*) — 1 = 그 값을 쓰지 않음', core: true, head: ['비트', '값', '뜻'], rows: [
    ['0~2', '1 · 2 · 4', '위치 x · y · z'], ['3~5', '8 · 16 · 32', '속도 vx · vy · vz'], ['6~8', '64 · 128 · 256', '가속도 (무시됨)'],
    ['9', '512', '가속도 대신 힘'], ['10', '1024', 'yaw'], ['11', '2048', 'yaw_rate'],
  ], note: '위치만 쓰기: 0b110111111000 (= 3576) · 속도만 쓰기: 0b110111000111 (= 3527)' },
  { id: 'state', title: '시스템 상태 (HEARTBEAT.system_status · MAV_STATE)', head: ['값', '이름', '뜻'], rows: [
    [3, 'STANDBY', '땅 위 대기'], [4, 'ACTIVE', '비행 중'], [5, 'CRITICAL', '위험 (추락 등)'],
  ] },
  { id: 'severity', title: 'STATUSTEXT.severity (MAV_SEVERITY)', head: ['값', '이름', ''], rows: [
    [0, 'EMERGENCY', ''], [1, 'ALERT', ''], [2, 'CRITICAL', ''], [3, 'ERROR', ''], [4, 'WARNING', ''], [5, 'NOTICE', ''], [6, 'INFO', ''], [7, 'DEBUG', ''],
  ] },
];

// ---------------------------------------------------------------------- pymavlink 함수
const PYMAV = [
  ['m = connect()', '가상 드론과 링크 열기 (= mavutil.mavlink_connection(\'udpin:0.0.0.0:14550\'))', true],
  ['m.wait_heartbeat()', '첫 HEARTBEAT 를 기다리고 m.target_system / m.target_component 를 채움', true],
  ['m.recv_match(type=\'이름\', blocking=True, timeout=초)', '원하는 메시지가 올 때까지 기다려 받음. 시간이 지나면 None. type 에 리스트도 가능', true],
  ['m.mav.<메시지이름 소문자>_send(…)', '메시지 보내기. 인자 순서는 각 메시지 카드의 "보내기" 참고', true],
  ['m.set_mode(\'GUIDED\')', 'SET_MODE 를 대신 만들어 보냄', true],
  ['m.arducopter_arm() / m.arducopter_disarm()', 'ARM/DISARM 명령을 대신 보냄', false],
  ['m.motors_armed()  ·  m.motors_armed_wait()  ·  m.motors_disarmed_wait()', '시동 상태 확인 / 걸릴 때까지 / 꺼질 때까지 기다리기', false],
  ['m.flightmode', '마지막 HEARTBEAT 의 모드 이름', false],
  ['m.messages[\'이름\']', '그 메시지의 가장 최근 값', false],
  ['mavutil.mavlink.MAV_CMD_NAV_TAKEOFF 등', '명령·좌표계·결과 번호 상수. L = mavutil.mavlink 로 줄여 쓰면 편함', false],
  ['mavutil.mavlink.enums[\'MAV_RESULT\'][값].name', '번호를 이름으로 바꾸기', false],
  ['msg.get_type()  ·  msg.get_srcSystem()  ·  msg.to_dict()', '받은 메시지의 종류 · 보낸 드론 SYSID · 필드 전체', false],
];

// ---------------------------------------------------------------------- 렌더링
const DIR = { down: ['드론 → 내 코드', 'd-down', '받기'], up: ['내 코드 → 드론', 'd-up', '보내기'], both: ['양방향', 'd-both', '받기 · 보내기'] };
const lower = (n) => n.toLowerCase();
const sendSig = (d) => `m.mav.${lower(d.name)}_send(${d.fields.map((f) => f.name).join(', ')})`;
const typeStr = (f) => f.type.replace('_t', '') + (f.len ? `[${f.len}]` : '');
const badge = (it) => (it.core ? '<span class="dx-core">⭐ 미션</span>' : it.bonus ? '<span class="dx-bonus">★ 보너스</span>' : '');

function exampleFrame() {
  // 지상국(SYSID 255, COMPID 190)이 보내는 HEARTBEAT 한 개 — 프레임 구조 설명용
  const f = ML.encode('HEARTBEAT', { type: 6, autopilot: 8, base_mode: 0, custom_mode: 0, system_status: 4, mavlink_version: 3 }, 0, 255, 190);
  return ML.toHex(f);
}

function msgCard(m) {
  const d = ML.BY_NAME[m.name];
  const [dirText, dirCls, how] = DIR[m.dir];
  const rows = d.fields.map((f) => `<tr><td class="mono">${f.name}</td><td class="mono dim">${typeStr(f)}</td><td>${esc(m.fields[f.name] || '')}</td></tr>`).join('');
  const py = [];
  if (m.dir !== 'down') py.push(`# 보내기 (인자 순서 그대로)\n${sendSig(d)}`);
  if (m.recv) py.push(`# 받기\n${m.recv}`);
  else if (m.dir !== 'up') py.push(`# 받기\nmsg = m.recv_match(type='${m.name}', blocking=True)\nprint(msg.${d.fields[0].name})`);
  if (m.name === 'COMMAND_LONG') py.push(`# 예: 명령 번호와 param 을 넣어 보내기\nm.mav.command_long_send(m.target_system, m.target_component,\n                        mavutil.mavlink.MAV_CMD_..., 0,   # command, confirmation\n                        p1, p2, p3, p4, p5, p6, p7)`);
  const cmdLinks = m.name === 'COMMAND_LONG' ? `<div class="dx-sub">이 메시지로 보내는 명령: ${COMMANDS.map((c) => `<a href="#" data-jump="cmd-${c.id}">${c.name.replace('MAV_CMD_', '')} (${c.id})</a>`).join(' · ')}</div>` : '';
  return `<details class="dx-card" id="msg-${m.name}" data-search="${esc([m.name, d.id, m.summary, ...Object.keys(m.fields), ...Object.values(m.fields), m.core ? '미션' : '', m.bonus ? '보너스' : ''].join(' ').toLowerCase())}"${m.core ? ' data-core' : ''}>
    <summary><span class="dx-name">${m.name}</span><span class="dx-id">#${d.id}</span><span class="dx-dir ${dirCls}">${dirText}</span>${m.rate ? `<span class="dx-rate">${m.rate}</span>` : ''}${badge(m)}<span class="dx-sum">${esc(m.summary.split('.')[0])}</span></summary>
    <div class="dx-body">
      <p>${esc(m.summary)}</p>
      <table class="dx-tbl"><tr><th>필드 (보내는 순서)</th><th>타입</th><th>뜻</th></tr>${rows}</table>
      <div class="dx-meta dim">메시지 ID ${d.id} · 페이로드 ${d.length}바이트 · CRC_EXTRA ${d.crc} · 파이썬에서 ${how}</div>
      ${cmdLinks}
      <pre class="dx-code">${esc(py.join('\n\n'))}</pre>
      ${m.tips ? `<ul class="dx-tips">${m.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    </div></details>`;
}

function cmdCard(c) {
  const params = [1, 2, 3, 4, 5, 6, 7].map((i) => `<tr><td class="mono">param${i}</td><td>${esc(c.params[i] || '— (0)')}</td></tr>`).join('');
  return `<details class="dx-card" id="cmd-${c.id}" data-search="${esc([c.name, c.id, c.summary, ...Object.values(c.params), c.core ? '미션' : '', c.bonus ? '보너스' : '', 'command_long'].join(' ').toLowerCase())}"${c.core ? ' data-core' : ''}>
    <summary><span class="dx-name">${c.name}</span><span class="dx-id">${c.id}</span>${badge(c)}<span class="dx-sum">${esc(c.summary)}</span></summary>
    <div class="dx-body">
      <p>${esc(c.summary)}. <a href="#" data-jump="msg-COMMAND_LONG">COMMAND_LONG</a> 의 command 에 <code>mavutil.mavlink.${c.name}</code> (= ${c.id}) 를 넣어 보냅니다. 대답은 <a href="#" data-jump="msg-COMMAND_ACK">COMMAND_ACK</a>.</p>
      <table class="dx-tbl"><tr><th>param</th><th>뜻</th></tr>${params}</table>
      ${c.tips ? `<ul class="dx-tips">${c.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    </div></details>`;
}

function tableCard(t) {
  return `<details class="dx-card" id="tbl-${t.id}" data-search="${esc([t.title, ...t.rows.flat(), t.note || '', t.core ? '미션' : ''].join(' ').toLowerCase())}"${t.core ? ' data-core' : ''}>
    <summary><span class="dx-name dx-tname">${esc(t.title)}</span>${badge(t)}</summary>
    <div class="dx-body">
      <table class="dx-tbl"><tr>${t.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${t.rows.map((r) => `<tr>${r.map((v, i) => `<td class="${i < 2 ? 'mono' : ''}">${esc(v)}</td>`).join('')}</tr>`).join('')}</table>
      ${t.note ? `<div class="dx-meta">${esc(t.note)}</div>` : ''}
    </div></details>`;
}

export class MavDictionary {
  constructor(root) {
    this.root = root;
    const core = MESSAGES.filter((m) => m.core), other = MESSAGES.filter((m) => !m.core);
    root.innerHTML = `
      <div class="dx-top">
        <input class="dx-search" type="search" placeholder="찾기: 이름 · 번호 · 뜻 (예: 이륙, 22, 고도, LED)">
        <label class="chk"><input type="checkbox" class="dx-coreonly"> ⭐ 미션에 필요한 것만</label>
        <button class="mini dx-expand">모두 펼치기</button>
      </div>
      <div class="dx-empty dim" hidden>찾는 항목이 없습니다.</div>

      <section class="dx-sec" data-sec>
        <h3>MAVLink 한눈에</h3>
        <details class="dx-card" open data-search="mavlink 프레임 frame sysid compid 구조 바이트 crc heartbeat 기본 개념 ned">
          <summary><span class="dx-name dx-tname">기본 개념 · 프레임 구조</span></summary>
          <div class="dx-body">
            <ul class="dx-tips">
              <li><b>메시지</b>: 정해진 필드(이름·타입·순서)를 가진 데이터 묶음. 메시지마다 번호(ID)가 있습니다.</li>
              <li><b>SYSID / COMPID</b>: 보낸 쪽 번호. 드론은 1, 2, 3 …, 오토파일럿 부품은 1. 내 코드(지상국)는 255 / 190.</li>
              <li><b>target_system / target_component</b>: 받을 쪽 번호. HEARTBEAT 로 알아낸 드론 번호를 넣습니다.</li>
              <li><b>NED 좌표</b>: x = 북, y = 동, z = <b>아래</b>. 고도 5 m 는 z = −5.</li>
              <li><b>명령 흐름</b>: COMMAND_LONG 으로 명령 → COMMAND_ACK 로 결과 확인.</li>
            </ul>
            <div class="dx-sub">예: 지상국이 보내는 HEARTBEAT 한 개 (MAVLink 2)</div>
            <div class="hex">${hexHtml(exampleFrame())}</div>${HEX_LEGEND}</div>
            <div class="dx-meta dim">STX(0xFD) · 길이 · 플래그 2바이트 · 순번 · SYSID · COMPID · 메시지 ID 3바이트 · 페이로드 · CRC 2바이트. 오른쪽 아래 인스펙터에서 실제로 오가는 프레임을 볼 수 있습니다.</div>
          </div>
        </details>
      </section>

      <section class="dx-sec" data-sec><h3>⭐ 미션에 필요한 메시지</h3>${core.map(msgCard).join('')}</section>
      <section class="dx-sec" data-sec><h3>명령 (COMMAND_LONG 의 command · MAV_CMD)</h3>${COMMANDS.map(cmdCard).join('')}</section>
      <section class="dx-sec" data-sec><h3>값 표</h3>${TABLES.map(tableCard).join('')}</section>
      <section class="dx-sec" data-sec><h3>그 밖의 메시지</h3>${other.map(msgCard).join('')}</section>
      <section class="dx-sec" data-sec><h3>pymavlink 자주 쓰는 함수</h3>
        <details class="dx-card" id="sec-pymav" open data-core data-search="${esc(PYMAV.flat().join(' ').toLowerCase())} pymavlink 함수 미션">
          <summary><span class="dx-name dx-tname">pymavlink (mavutil)</span></summary>
          <div class="dx-body"><table class="dx-tbl dx-pym">${PYMAV.map(([c, d, k]) => `<tr><td class="mono">${k ? '⭐ ' : ''}${esc(c)}</td><td>${esc(d)}</td></tr>`).join('')}</table></div>
        </details>
      </section>`;
    this.$ = (s) => root.querySelector(s);
    this.$('.dx-search').oninput = () => this.filter();
    this.$('.dx-coreonly').onchange = () => this.filter();
    this.$('.dx-expand').onclick = () => {
      const cards = [...root.querySelectorAll('.dx-card')].filter((c) => !c.hidden);
      const open = cards.some((c) => !c.open);
      cards.forEach((c) => { c.open = open; });
      this.$('.dx-expand').textContent = open ? '모두 접기' : '모두 펼치기';
    };
    root.addEventListener('click', (e) => {
      const a = e.target.closest('[data-jump]');
      if (!a) return;
      e.preventDefault();
      this.show(a.dataset.jump);
    });
  }

  /** 카드 하나를 펼쳐서 보여 줌 (검색 조건 때문에 숨어 있으면 조건을 풂) */
  show(id) {
    const el = this.root.querySelector('#' + CSS.escape(id));
    if (!el) return;
    if (el.hidden) { this.$('.dx-search').value = ''; this.$('.dx-coreonly').checked = false; this.filter(); }
    el.open = true;
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    el.classList.add('dx-flash');
    setTimeout(() => el.classList.remove('dx-flash'), 1200);
  }

  filter() {
    const q = this.$('.dx-search').value.trim().toLowerCase();
    const coreOnly = this.$('.dx-coreonly').checked;
    let any = false;
    for (const sec of this.root.querySelectorAll('[data-sec]')) {
      let shown = 0;
      for (const c of sec.querySelectorAll('.dx-card')) {
        const ok = (!coreOnly || c.hasAttribute('data-core')) && (!q || q.split(/\s+/).every((w) => c.dataset.search.includes(w)));
        c.hidden = !ok;
        if (ok) { shown++; if (q) c.open = true; }
      }
      sec.hidden = !shown;
      any ||= shown > 0;
    }
    this.$('.dx-empty').hidden = any;
  }
}
