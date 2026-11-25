// 2일차 관리자 테스트 코드 — 관리자만 2일차 화면의 '🔧 테스트 코드' 버튼으로 불러올 수 있음 (학생에게는 내려가지 않음)
// 각 폴더가 하나의 학생 프로젝트 — 시작 코드와 같은 구조(main.py 의 main + plan). 파일을 고치면 서버를 다시 시작할 때 반영됨.
// expect 는 이 저장소의 케이스(server/cases.js)로 직접 돌려 확인한 결과
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const SAMPLES = [
  { id: "01-fast", group: "성공", title: "전부 성공 · 빠름 — 우선순위 계획", expect: "7/7 통과 · 시간 합 265.61 s",
    desc: "가는 길 · 돌아오는 길을 먼 드론부터 한 대씩: 직선이 막히면 출발을 늦추거나 위 · 아래로 돌아감. 아직 안 떠난 드론은 장애물로 봐서 밀집 대형도 빠르게. 못 찾으면 고도 분리로." },
  { id: "02-layered", group: "성공", title: "전부 성공 · 느림 — 고도 분리", expect: "7/7 통과 · 시간 합 544.26 s",
    desc: "드론마다 다른 고도 층 → 상승 · 수평 이동 · 하강을 같은 박자로, 대형 유지 뒤 같은 길로 복귀." },
  { id: "03-straight", group: "충돌", title: "충돌 — 직선 최고 속도 (시작 코드 그대로)", expect: "0/7 · 7개 모두 충돌",
    desc: "모든 드론이 목표까지 직선, 모두 모이면 직선으로 복귀. 학생이 처음 받는 시작 코드의 예시와 같음." },
  { id: "04-narrow-gap", group: "충돌", title: "일부 충돌 — 고도 분리, 층 간격 딱 0.3 m", expect: "4/7 통과 (공개 2개 + 밀집 큐브 · 밀집 2단 링, 257.11 s) · 자리 바꾸기 · 좁은 형상 · 기둥 쌓기 충돌",
    desc: "02 와 같지만 층 간격이 min_sep 과 똑같은 0.3 m. 공개 케이스는 통과하지만 자리 바꾸기 · 좁은 형상 · 기둥 쌓기에서 충돌 (밀집 큐브 · 2단 링은 운 좋게 통과)." },
  { id: "09-timing-only", group: "충돌", title: "일부 충돌 — 출발 시각(속도)만 조절, 경로는 직선", expect: "3/7 통과 (원형 · 구 · 자리 바꾸기, 106.03 s) · 좁은 형상 · 기둥 쌓기 · 밀집 2개 충돌",
    desc: "직선은 그대로 두고 겹치는 드론의 출발만 늦춤. 넓게 퍼진 대형은 통과하지만 밀집 대형 · 좁은 형상에서는 피할 수 없어 충돌 — 밀집 케이스가 왜 필요한지 보여 주는 예." },
  { id: "05-compile-error", group: "에러", title: "컴파일 에러 — for 문 콜론 빠짐", expect: "7개 모두 컴파일 에러 (main.py 32번째 줄)",
    desc: "02 와 같지만 문법 오류가 하나 있음. 첫 케이스에서 잡혀 나머지는 실행하지 않음." },
  { id: "06-timeout", group: "에러", title: "시간 초과 — 0.0001초 간격 전수 검사", expect: "7개 모두 시간 초과 (제출 하나에 약 15초 × 7 ≈ 2분)",
    desc: "경로는 맞지만 충돌이 없는지 0.0001초마다 190쌍을 직접 확인하느라 너무 느림." },
  { id: "07-runtime-error", group: "에러", title: "런타임 에러 — 입력 키 오타", expect: "7개 모두 런타임 에러 (KeyError: 'target')",
    desc: "problem['targets'] 대신 problem['target'] 을 읽음." },
  { id: "08-speed-violation", group: "에러", title: "규칙 위반 — 속도 초과 (v_max × 2)", expect: "7개 모두 규칙 위반 (속도 초과)",
    desc: "고도 분리는 맞지만 v_max 의 2배 속도로 계산." },
];

/** 폴더의 .py 파일을 {상대경로: 내용} 으로 */
export function loadSample(id) {
  const meta = SAMPLES.find((s) => s.id === id);
  if (!meta) return null;
  const root = path.join(HERE, id);
  const files = {};
  const walk = (dir, rel) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name), r = rel ? `${rel}/${name}` : name;
      if (fs.statSync(full).isDirectory()) { if (name !== '__pycache__') walk(full, r); } else if (name.endsWith('.py')) files[r] = fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n');
    }
  };
  walk(root, '');
  return { ...meta, files };
}
