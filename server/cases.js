// 2일차 테스트 케이스. 좌표 단위 m, z 는 위가 +
//  - i번 드론은 starts[i] 에서 출발해 targets[i] 에 도착해야 함 (할당 고정)
//  - public: 학생에게 입력을 공개 (▶ 실행으로 브라우저에서 확인 가능)
//  - graded: 공식 채점(✔ 제출)에 쓰는 케이스 — 공개 2개 + 비공개 3개
//  - 비공개 케이스의 입력은 서버 밖으로 나가지 않음 (채점도 서버에서 실행)
const N = 20;
const r3 = (p) => p.map((v) => Math.round(v * 1000) / 1000);
export const RULES = { v_max: 1.0, min_sep: 0.3, tol: 0.1 };

/** 착륙장 A: 5 × 4, 2 m 간격, z = 0 */
export const PAD = Array.from({ length: N }, (_, i) => [2 * (i % 5), 2 * Math.floor(i / 5), 0]);

// ---------------------------------------------------------------- 공개 케이스
// 1. 이륙 격자: 착륙장 배치를 1.5배로 넓혀 고도 8 m
const grid = PAD.map(([x, y]) => r3([4 + (x - 4) * 1.5, 3 + (y - 3) * 1.5, 8]));
// 2. 원형: 중심 (4, 3), 반지름 7 m, 고도 10 m — 착륙장 순서대로 링에 배치해 경로가 엇갈림
const ring = Array.from({ length: N }, (_, k) => { const a = (2 * Math.PI * k) / N; return r3([4 + 7 * Math.cos(a), 3 + 7 * Math.sin(a), 10]); });
// 3. 글자 "SJ": 착륙장 북쪽 y = 14 의 수직면 (x-z 평면), 1.2 m 격자
const S = [[3, 6], [2, 6], [1, 6], [0, 5], [0, 4], [1, 3], [2, 3], [3, 2], [3, 1], [2, 0], [1, 0]];
const J = [[6, 6], [7, 6], [8, 6], [7, 5], [7, 4], [7, 3], [7, 2], [6, 1], [5, 2]];
const letters = [...S, ...J].map(([gx, gz]) => r3([gx * 1.2 - 1, 14, 4 + gz * 1.2]));
// 4. 구: 중심 (4, 3, 12), 반지름 4.5 m (피보나치 구) — 진짜 3D
const sphere = Array.from({ length: N }, (_, k) => {
  const y = 1 - (2 * (k + 0.5)) / N, rr = Math.sqrt(1 - y * y), th = k * Math.PI * (3 - Math.sqrt(5));
  return r3([4 + 4.5 * rr * Math.cos(th), 3 + 4.5 * rr * Math.sin(th), 12 + 4.5 * y]);
});

// ---------------------------------------------------------------- 비공개 케이스 (각각 다른 충돌을 유도)
// 5. 자리바꾸기: 고도 5 m 에 마주 보는 두 줄 (y = 0, y = 8). 0~9번과 10~19번이 서로 자리를 바꿈 → 직선이면 정면 충돌
const rowA = Array.from({ length: 10 }, (_, k) => [2 * k, 0, 5]);
const rowB = Array.from({ length: 10 }, (_, k) => [2 * k, 8, 5]);
const swapStarts = [...rowA, ...rowB];
const swapTargets = [...rowB, ...rowA];
// 6. 좁은 형상: 착륙장 → y = 10 수직면의 0.45 m 간격 5 × 4 블록 (min_sep 0.3 에 가까움). 배치를 뒤집어 경로가 교차
const block = Array.from({ length: N }, (_, k) => r3([4 + ((k % 5) - 2) * 0.45, 10, 6 + Math.floor(k / 5) * 0.45]));
const blockTargets = PAD.map((_, i) => block[N - 1 - i]);
// 7. 반대편 건너기: 반지름 6 m 원 위 20대가 정반대 점으로 → 모든 직선 경로가 중심을 지남
const circle = (a) => r3([6 + 6 * Math.cos(a), 6 + 6 * Math.sin(a), 4]);
const antiStarts = Array.from({ length: N }, (_, k) => circle((2 * Math.PI * k) / N));
const antiTargets = Array.from({ length: N }, (_, k) => circle((2 * Math.PI * k) / N + Math.PI));

export const CASES = [
  { id: 1, name: '이륙 격자', desc: '착륙장 배치를 1.5배로 넓혀 고도 8 m 로', starts: PAD, targets: grid, public: true, graded: false },
  { id: 2, name: '원형', desc: '반지름 7 m 수평 링 — 경로가 엇갈림', starts: PAD, targets: ring, public: true, graded: true },
  { id: 3, name: '글자 SJ', desc: '수직면(x-z) 위의 글자 모양', starts: PAD, targets: letters, public: true, graded: false },
  { id: 4, name: '구', desc: '반지름 4.5 m 구 — 진짜 3D 대형', starts: PAD, targets: sphere, public: true, graded: true },
  { id: 5, name: '자리바꾸기', desc: '마주 보는 두 줄이 서로 자리를 바꿈 (정면 충돌 유도)', starts: swapStarts, targets: swapTargets, public: false, graded: true },
  { id: 6, name: '좁은 형상', desc: '0.45 m 간격 블록, 배치를 뒤집어 교차 (근접 충돌 유도)', starts: PAD, targets: blockTargets, public: false, graded: true },
  { id: 7, name: '반대편 건너기', desc: '원 위 20대가 정반대 점으로 (중심 집중 충돌 유도)', starts: antiStarts, targets: antiTargets, public: false, graded: true },
];
export const PUBLIC_CASES = CASES.filter((c) => c.public);
export const GRADED_CASES = CASES.filter((c) => c.graded);

/** 학생 프로그램 stdin 으로 들어가는 입력 */
export function caseInput(c) {
  return { v_max: RULES.v_max, min_sep: RULES.min_sep, tol: RULES.tol, starts: c.starts, targets: c.targets };
}
/** 학생에게 보이는 이름 (비공개 케이스는 번호만) */
export function studentCaseName(c) {
  return c.public ? c.name : `비공개 ${GRADED_CASES.filter((x) => !x.public).indexOf(c) + 1}`;
}
