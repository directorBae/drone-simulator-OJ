# Drone Lab / Drone OJ — 드론으로 배우는 Physical AI

세종대학교 인공지능학과 특강(URANUS)용 웹 실습 환경입니다. 브라우저 하나로 진행하며 설치할 것이 없습니다.

| 화면 | 주소 | 내용 |
|---|---|---|
| 첫 화면 | `/` | 1일차 · 2일차 입구 |
| **1일차** · 내 코드로 드론 띄우기 | `/day1/` | 파이썬(pymavlink)으로 MAVLink 메시지를 보내 가상 드론을 움직이고, LED를 켜고, 받은 메시지를 확인. **항상 공개** |
| **2일차** · 드론 20대, 충돌 없이 가장 빠르게 | `/day2/` | 군집 경로 생성 알고리즘 온라인 저지. 학번 가입 · 코드 서버 저장 · 자동 채점 · 3D 리플레이. **관리자가 정한 시각(기본 2026-12-01 00:00 KST)부터 공개** |
| 스코어보드 (대형 화면) | `/leaderboard/` | 실시간 순위. 관리자가 공개해야 보임 |
| 관리자 | `/admin/` | 일정·공개 설정, 학생 코드·이름 조회, 비밀번호 0000 초기화, 계정 삭제, 제출 현황 |

---

## 1일차 — MAVLink 실습

- **왼쪽**: 코드 편집기(문법 · pyflakes 검사, 오류 줄 표시) / **메시지 작성기**(코드 없이 메시지를 골라 바로 전송, 바이트와 같은 동작의 파이썬 코드 표시) / **미션 체크포인트**(연결 → 이륙 → 정사각형 → 착륙 + 보너스 자동 체크) / 콘솔과 REPL
- **오른쪽**: NED 좌표계 3D 화면(드론 1~3대, LED, 지상국 ↔ 드론 신호 펄스, 충돌 표시), **통신 링크 패널**(업링크·다운링크 레인에 패킷이 흐르고, 57,600 baud 대비 사용률 표시), MAVLink 인스펙터(프레임을 바이트 단위로 색 구분)
- `print()` 출력은 콘솔과 드론 위 말풍선에 나타납니다.
- 실행 시간 제한 120초.

### 학생 코드 (pymavlink 그대로)
```python
from pymavlink import mavutil
m = connect()                         # = mavutil.mavlink_connection('udpin:0.0.0.0:14550')
m.wait_heartbeat()
m.set_mode('GUIDED')
m.mav.command_long_send(m.target_system, m.target_component,
                        mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM, 0, 1, 0, 0, 0, 0, 0, 0)
```
브라우저(Pyodide)에서는 진짜 pymavlink를 설치할 수 없어 `public/py/pymavlink/`에 **호환 모듈**을 넣었습니다. 진짜 MAVLink 2 프레임(X.25 CRC + CRC_EXTRA, 페이로드 끝의 0 잘라내기)을 만들고 해석하며, **14개 메시지 모두 실제 pymavlink와 바이트 단위로 같습니다**. 그래서 같은 코드가 실제 드론이나 SITL에서도 동작합니다.

### 가상 드론 (ArduCopter를 단순화한 동작)
| 드론이 보냄 | 드론이 받음 |
|---|---|
| HEARTBEAT 1Hz · SYS_STATUS 1Hz · ATTITUDE 10Hz · LOCAL_POSITION_NED 10Hz · GLOBAL_POSITION_INT 5Hz · VFR_HUD 4Hz · COMMAND_ACK · STATUSTEXT | SET_MODE · COMMAND_LONG · SET_POSITION_TARGET_LOCAL_NED(frame 1/7/8/9) · SET_POSITION_TARGET_GLOBAL_INT · **LED_CONTROL** · REQUEST_DATA_STREAM · HEARTBEAT |

- COMMAND_LONG: ARM/DISARM 400 · TAKEOFF 22 · LAND 21 · RTL 20 · DO_SET_MODE 176 · DO_CHANGE_SPEED 178 · CONDITION_YAW 115 · **DO_SET_RELAY 181 / DO_REPEAT_RELAY 182 (LED 켜기·반복 점멸)** · SET_MESSAGE_INTERVAL 511 · REQUEST_MESSAGE 512
- LED: `led_control_send(ts, tc, 42, 42, 3, [R,G,B]+[0]*21)` 단색, `custom_len=4` 이면 4번째 바이트가 깜빡임(Hz), `pattern=0` 끔
- 실제 기체와 비슷하게: TAKEOFF는 GUIDED + ARM에서만 · 시동 후 10초 안에 이륙하지 않으면 자동 시동 꺼짐 · 속도 명령은 3초간 새로 오지 않으면 정지 · 비행 중 DISARM 거부(강제 21196 → 추락) · 드론끼리 0.6m 안으로 가까워지면 충돌
- **잘못된 메시지 알림**: CRC 불일치 · 알 수 없는 msgid · 0xFD/0xFE가 아닌 바이트 · 없는 SYSID · 잘못된 target_component · 지원하지 않는 모드/명령/좌표계 · `z>0`(지면 아래) 같은 실수는 회색 `[sim]` 로그와 빨간 알림으로 **이유**가 나옵니다.
- 각 드론의 LOCAL_POSITION_NED 원점은 자기 출발점, 홈은 세종대(37.5503, 127.0731). 드론 2·3은 동쪽으로 3m씩 떨어져 출발합니다.

---

## 2일차 — 군집 경로 챌린지 (온라인 저지)

학생 프로그램이 입력 JSON을 읽어 20대의 경로를 **정해진 JSON 형식**으로 출력하면, OJ가 검사합니다.

```text
입력 (stdin)  {"v_max": 3.0, "starts": [[x,y,z]×20], "targets": [[x,y,z]×20], "min_sep": 0.3, "tol": 0.1, "hold": 1.0}
출력 (stdout) {"paths": [ [[t,x,y,z], ...] × 20 ]}       # 단위 m, z 는 위가 +
```

| 규칙 | 값 |
|---|---|
| 착륙장 A | i번 드론 시작점 = (2·(i mod 5), 2·⌊i/5⌋, 0) |
| 속도 | 모든 구간 속력 ≤ v_max = **3.0 m/s** |
| 대형 완성 | 20개 목표점을 모두 **0.1 m** 이내로 **동시에 1.0 s** 이상 채움 · 할당 자유 |
| 복귀 | 마지막 웨이포인트 = 자기 착륙 지점(z=0) |
| 형식 | 첫 웨이포인트 t=0 · 자기 착륙 지점, t는 엄격히 증가, 드론당 웨이포인트 ≤ 20,000 |
| 영역 | x −30~40 · y −30~40 · z 0~40, 미션 시간 ≤ 300 s |
| 충돌 | max(\|Δx\|,\|Δy\|,\|Δz\|) < **0.3** (정확히 0.3은 허용). 웨이포인트 사이 직선 보간, **연속 시간 전체를 해석적으로** 검사 (샘플링 아님) |
| 계산 시간 | 케이스당 30 s |
| 미션 시간 | 마지막 드론이 착륙한 시각 |
| 순위 | 5개 케이스 모두 성공한 학생 중 미션 시간 합이 작은 순 · 동점이면 먼저 제출한 순 · 자기 최고 기록 기준 |

**채점 결과**: 성공 · 충돌 에러(드론 i·j, 시각, 위치) · 컴파일 에러(파일·줄) · 런타임 에러 · 규칙 위반(속도 초과·대형 미완성·미복귀·영역 이탈·형식 오류) · 시간 초과

**테스트 케이스**: ① 평면 격자 ② 원형 링 ③ 글자 “SJ”(수직면) ④ 구 ⑤ 비공개(이중 나선). 5번은 서버에만 있고 제출할 때만 내려갑니다 — `server/cases.js`

**코드 작성**: 여러 파일·폴더(패키지)로 나눠 작성 · 파일/폴더 업로드 · 서버 자동 저장. 시작 프로젝트는 `main.py` + `planner/`(Problem · Vec3 · Path · Solver 클래스)이고 입출력 형식은 이미 맞춰져 있습니다.

**▶ 실행**: 공개 케이스 하나로 실행 → 브라우저에서 즉시 채점 → 20대 3D 리플레이(타임라인, 충돌 순간 자동 정지와 빨간 상자 표시).
**✔ 제출**: 5개 케이스를 실행해 결과를 서버로 보내고, **서버가 같은 채점기(`public/js/day2/judge.js`)로 공식 채점**해 저장하며, 스코어보드에 실시간으로 반영합니다.

---

## 서버 운영 (AWS 등)

Node.js 22.13 이상 + 내장 SQLite만 씁니다. 별도 DB 서버가 필요 없습니다.

### Docker (권장)
```bash
git clone https://github.com/directorBae/drone-simulator-OJ.git && cd drone-simulator-OJ
# docker-compose.yml 의 ADMIN_PASSWORD 를 바꾼 뒤
docker compose up -d --build          # 80 포트 → 컨테이너 8080
```
- 데이터: `./data/droneoj.db` (학생 계정 · 코드 · 제출). 이 파일만 백업하면 됩니다.
- AWS EC2 / Lightsail: Ubuntu에 Docker 설치 → 위 명령 → 보안 그룹에서 80(또는 443) 열기. 30명 규모면 t3.small 정도로 충분합니다. 채점 연산은 학생 브라우저에서 하고, 서버는 결과 검증만 합니다.
- HTTPS: 로드밸런서(ALB)나 nginx 뒤에 두고 `COOKIE_SECURE=1`을 설정하세요. SSE(`/api/events`)를 쓰므로 nginx라면 `proxy_buffering off;`가 필요합니다.

### 직접 실행
```bash
cd server && npm ci
ADMIN_PASSWORD=비밀번호 PORT=8080 npm start
```

| 환경 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | 8080 | |
| `ADMIN_PASSWORD` | (없으면 시작할 때 무작위로 만들어 로그에 출력) | `/admin` 로그인 |
| `DATA_DIR` | `./data` | SQLite 위치 |
| `COOKIE_SECURE` | – | `1`이면 HTTPS에서만 쿠키 전송 |

### 관리자 페이지 (`/admin`)
- **일정·공개**: 2일차 공개 시각 · 스코어보드(예약 시각 자동 공개 / 지금 공개 / 비공개) · 제출 마감. 서버 시계 기준이고, 바뀌면 열려 있는 화면에 바로 반영됩니다.
- **학생**: 학번 · 이름 · 제출 수 · 최고 기록 / 현재 코드와 제출별 코드 보기 / **비밀번호 0000 초기화** / 계정 삭제
- **제출 현황**(실시간) · **스코어보드**(항상 보임, 학번 전체 표시) · **테스트 케이스**(비공개 포함)

### 점검 도구
```bash
node server/tools/judge-selftest.mjs <풀이.py>   # 5개 케이스를 CPython 으로 돌려 채점기로 검사
```

---

## 구조
```
public/                       정적 화면 (서버 없이 1일차만 쓸 때는 아무 정적 호스팅에 올려도 됨)
  index.html                  첫 화면
  day1/  js/day1/             1일차: app · scene1(3D) · linkviz(통신 링크) · builder(메시지 작성기) · missions · examples
  day2/  js/day2/             2일차: app · judge(채점기, 서버와 공용) · replay(3D) · files(파일 트리) · starter · lb
  admin/ js/admin/            관리자
  leaderboard/                대형 화면 스코어보드
  js/core/                    공용: mavlink(코덱) · sim(드론 월드) · runner-worker(Pyodide) · lint-worker · stage(three.js) · ui
  py/pymavlink/               pymavlink 호환 모듈
server/
  server.js                   Express: 정적 파일 · 공개 시각 게이트 · 인증 · 프로젝트 저장 · 제출/채점 · SSE · 관리자 API
  db.js                       SQLite 스키마 · 설정 · 비밀번호(scrypt)
  cases.js                    2일차 테스트 케이스 (비공개 포함)
```

## 알려진 제한
- 학생 코드는 각자 브라우저(Pyodide)에서 실행되고, 서버는 그 **출력 경로를 다시 채점**합니다. 경로 검증은 서버가 하므로 결과를 꾸밀 수는 없지만, 개발자 도구로 비공개 케이스 입력을 볼 수는 있습니다. 의심되면 관리자 페이지에서 해당 학생의 제출 코드를 확인하세요.
- 첫 접속 때 Pyodide(약 10MB), three.js, CodeMirror를 CDN에서 받으므로 강의실 인터넷이 필요합니다.
- `time.sleep()`은 시뮬레이션을 진행하면서 기다리느라 CPU 코어 하나를 사용합니다.
