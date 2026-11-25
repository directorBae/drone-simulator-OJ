// 2일차 관리자 테스트 코드 — 관리자만 2일차 화면의 '🔧 테스트 코드' 버튼으로 불러올 수 있음 (학생에게는 내려가지 않음)
// 각 폴더가 하나의 학생 프로젝트 — 시작 코드와 같은 구조(main.py 의 main + plan). 파일을 고치면 서버를 다시 시작할 때 반영됨.
// expect 는 이 저장소의 케이스(server/cases.js)로 직접 돌려 확인한 결과
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const SAMPLES = [
  { id: "01-fast", group: "성공", title: "전부 성공 · 빠름 — 우선순위 계획", expect: "5/5 통과 · 시간 합 75.85 s",
    desc: "먼 드론부터 한 대씩: 직선이 막히면 출발을 늦추거나 위로 돌아가는 경로 중 가장 빨리 도착하는 것을 고름. 못 찾으면 고도 분리로." },
  { id: "02-layered", group: "성공", title: "전부 성공 · 느림 — 고도 분리", expect: "5/5 통과 · 시간 합 189.95 s",
    desc: "드론마다 다른 고도 층 → 상승 · 수평 이동 · 하강을 모두 같은 박자로." },
  { id: "03-straight", group: "충돌", title: "충돌 — 직선 최고 속도 (시작 코드 그대로)", expect: "0/5 · 5개 모두 충돌",
    desc: "모든 드론이 목표까지 직선으로. 학생이 처음 받는 시작 코드의 예시와 같음." },
  { id: "04-narrow-gap", group: "충돌", title: "일부 충돌 — 고도 분리, 층 간격 0.2 m", expect: "1/5 통과 (비공개 1만, 17.62 s) · 나머지 충돌",
    desc: "02 와 같지만 층 간격이 min_sep(0.3) 보다 좁은 0.2 m. 수평 이동 중 위아래 드론이 부딪힘." },
  { id: "05-compile-error", group: "에러", title: "컴파일 에러 — for 문 콜론 빠짐", expect: "5개 모두 컴파일 에러 (main.py 29번째 줄)",
    desc: "02 와 같지만 문법 오류가 하나 있음. 첫 케이스에서 잡혀 나머지는 실행하지 않음." },
  { id: "06-timeout", group: "에러", title: "시간 초과 — 0.0001초 간격 전수 검사", expect: "5개 모두 시간 초과 (제출 하나에 케이스당 제한 시간 × 5 만큼 걸림)",
    desc: "경로는 맞지만 충돌이 없는지 0.0001초마다 190쌍을 직접 확인하느라 너무 느림." },
  { id: "07-runtime-error", group: "에러", title: "런타임 에러 — 입력 키 오타", expect: "5개 모두 런타임 에러 (KeyError: 'target')",
    desc: "problem['targets'] 대신 problem['target'] 을 읽음." },
  { id: "08-speed-violation", group: "에러", title: "규칙 위반 — 속도 초과 (v_max × 2)", expect: "5개 모두 규칙 위반 (속도 초과)",
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
