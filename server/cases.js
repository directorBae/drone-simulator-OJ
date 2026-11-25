// 2일차 테스트 케이스. 좌표 단위 m, z 는 위가 +
//  - 미션: 착륙장(PAD)의 드론 20대로 목표 모양을 만들고(동시에 hold 초) 다시 착륙장으로 복귀
//  - i번 드론은 starts[i](= 착륙장 i번 자리)에서 출발 → targets[i] → starts[i] (할당 고정)
//  - public: 학생에게 입력을 공개 (▶ 실행으로 브라우저에서 확인 가능)
//  - graded: 공식 채점(✔ 제출)에 쓰는 케이스 — 공개 2개 + 비공개 5개 = 7개
//  - 8 ~ 10: 밀집 비행 — 목표끼리 중심 간 0.4 m (0.3 m 드론의 외곽 간 10 cm)
//  - 비공개 케이스의 입력은 서버 밖으로 나가지 않음 (채점도 서버에서 실행)
const N = 20;
const r3 = (p) => p.map((v) => Math.round(v * 1000) / 1000);
export const RULES = { v_max: 1.0, min_sep: 0.3, tol: 0.1, hold: 1.0 };

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

// ---------------------------------------------------------------- 비공개 케이스 (모두 착륙장에서 출발 · 각각 다른 충돌을 유도)
// 5. 자리 바꾸기: 착륙장 배치를 180° 돌린 자리의 6 m 상공으로 → 모든 직선 경로가 한가운데에서 정면으로 만남
const swapTargets = PAD.map(([x, y]) => [8 - x, 6 - y, 6]);
// 6. 좁은 형상: y = 10 수직면의 0.45 m 간격 5 × 4 블록 (min_sep 0.3 에 가까움). 배치를 뒤집어 경로가 교차
const block = Array.from({ length: N }, (_, k) => r3([4 + ((k % 5) - 2) * 0.45, 10, 6 + Math.floor(k / 5) * 0.45]));
const blockTargets = PAD.map((_, i) => block[N - 1 - i]);
// 7. 기둥 쌓기: 착륙장 가운데 위 한 기둥에 0.4 m 간격으로 20대를 쌓음 (순서를 섞어 한 점으로 몰리는 충돌 유도)
const towerTargets = PAD.map((_, i) => r3([4, 3, 4 + ((i * 7) % N) * 0.4]));

// ---------------------------------------------------------------- 밀집 비행 (목표끼리 중심 간 0.4 m = 외곽 간 10 cm)
const D = 0.4;
// 8. (공개 · 연습) 밀집 판: 고도 6 m 의 5 × 4 판. 착륙장 배치를 180° 돌려 배정 → 경로가 한가운데에서 교차
const sheet = PAD.map(([x, y]) => r3([4 + (x / 2 - 2) * D, 3 + (y / 2 - 1.5) * D, 6]));
const sheetTargets = PAD.map((_, i) => sheet[N - 1 - i]);
// 9. (비공개) 밀집 큐브: 5 × 2 × 2 상자. 배정을 섞어 안쪽 · 아래쪽 자리로 가는 길이 서로 막힘
const cube = Array.from({ length: N }, (_, k) => r3([4 + ((k % 5) - 2) * D, 3 + ((Math.floor(k / 5) % 2) - 0.5) * D, 6 + Math.floor(k / 10) * D]));
const cubeTargets = PAD.map((_, i) => cube[(i * 7) % N]);
// 10. (비공개) 밀집 2단 링: 10대씩 두 층(위아래 0.4 m), 반지름 0.82 m (이웃 간 최소 0.4 m). 배정을 섞어 교차
const ring2 = Array.from({ length: N }, (_, k) => { const a = (2 * Math.PI * (k % 10)) / 10; return r3([4 + 0.82 * Math.cos(a), 3 + 0.82 * Math.sin(a), 6 + Math.floor(k / 10) * D]); });
const ring2Targets = PAD.map((_, i) => ring2[(i * 3) % N]);

export const CASES = [
  { id: 1, name: '이륙 격자', desc: '착륙장 배치를 1.5배로 넓혀 고도 8 m 로', starts: PAD, targets: grid, public: true, graded: false },
  { id: 2, name: '원형', desc: '반지름 7 m 수평 링 — 경로가 엇갈림', starts: PAD, targets: ring, public: true, graded: true },
  { id: 3, name: '글자 SJ', desc: '수직면(x-z) 위의 글자 모양', starts: PAD, targets: letters, public: true, graded: false },
  { id: 4, name: '구', desc: '반지름 4.5 m 구 — 진짜 3D 대형', starts: PAD, targets: sphere, public: true, graded: true },
  { id: 5, name: '자리 바꾸기', desc: '착륙장 배치를 180° 돌린 자리의 상공으로 (한가운데 정면 충돌 유도)', starts: PAD, targets: swapTargets, public: false, graded: true },
  { id: 6, name: '좁은 형상', desc: '0.45 m 간격 블록, 배치를 뒤집어 교차 (근접 충돌 유도)', starts: PAD, targets: blockTargets, public: false, graded: true },
  { id: 7, name: '기둥 쌓기', desc: '한 기둥에 0.4 m 간격으로 20대 (한 점으로 몰리는 충돌 유도)', starts: PAD, targets: towerTargets, public: false, graded: true },
  { id: 8, name: '밀집 판', desc: '밀집 비행 · 0.4 m 간격 5 × 4 판, 배치를 뒤집어 한가운데에서 교차', starts: PAD, targets: sheetTargets, public: true, graded: false },
  { id: 9, name: '밀집 큐브', desc: '밀집 비행 · 0.4 m 간격 5 × 2 × 2 상자 (안쪽 · 아래쪽 자리가 막힘)', starts: PAD, targets: cubeTargets, public: false, graded: true },
  { id: 10, name: '밀집 2단 링', desc: '밀집 비행 · 0.4 m 간격 두 층 링 (반지름 0.82 m)', starts: PAD, targets: ring2Targets, public: false, graded: true },
];
export const PUBLIC_CASES = CASES.filter((c) => c.public);
export const GRADED_CASES = CASES.filter((c) => c.graded);

/** 학생 프로그램 stdin 으로 들어가는 입력 */
export function caseInput(c) {
  return { v_max: RULES.v_max, min_sep: RULES.min_sep, tol: RULES.tol, hold: RULES.hold, starts: c.starts, targets: c.targets };
}
/** 학생에게 보이는 이름 (비공개 케이스는 번호만) */
export function studentCaseName(c) {
  return c.public ? c.name : `비공개 ${GRADED_CASES.filter((x) => !x.public).indexOf(c) + 1}`;
}
