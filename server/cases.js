// 2일차 테스트 케이스 5개 (5번은 비공개). 좌표 m, z 는 위가 +
// i번 드론 시작점 = (2·(i mod 5), 2·⌊i/5⌋, 0)
const N = 20;
const r3 = (p) => p.map((v) => Math.round(v * 1000) / 1000);
export const STARTS = Array.from({ length: N }, (_, i) => [2 * (i % 5), 2 * Math.floor(i / 5), 0]);
export const RULES = { v_max: 3.0, min_sep: 0.3, tol: 0.1, hold: 1.0 };

// 1. 평면 격자: 착륙장 배치를 1.5배로 넓혀 고도 8 m 로
const grid = STARTS.map(([x, y]) => r3([4 + (x - 4) * 1.5, 3 + (y - 3) * 1.5, 8]));

// 2. 원형: 중심 (4, 3), 반지름 7 m, 고도 10 m 수평 링 (교차 경로가 생김)
const ring = Array.from({ length: N }, (_, k) => {
  const a = (2 * Math.PI * k) / N;
  return r3([4 + 7 * Math.cos(a), 3 + 7 * Math.sin(a), 10]);
});

// 3. 글자 "SJ": 착륙장 북쪽 y = 14 의 수직면 (x-z 평면), 1.2 m 격자
const S = [[3, 6], [2, 6], [1, 6], [0, 5], [0, 4], [1, 3], [2, 3], [3, 2], [3, 1], [2, 0], [1, 0]];
const J = [[6, 6], [7, 6], [8, 6], [7, 5], [7, 4], [7, 3], [7, 2], [6, 1], [5, 2]];
const letters = [...S, ...J].map(([gx, gz]) => r3([gx * 1.2 - 1, 14, 4 + gz * 1.2]));

// 4. 구: 중심 (4, 3, 12), 반지름 4.5 m 위에 고르게 (피보나치 구)
const sphere = Array.from({ length: N }, (_, k) => {
  const y = 1 - (2 * (k + 0.5)) / N, rr = Math.sqrt(1 - y * y), th = k * Math.PI * (3 - Math.sqrt(5));
  return r3([4 + 4.5 * rr * Math.cos(th), 3 + 4.5 * rr * Math.sin(th), 12 + 4.5 * y]);
});

// 5. (비공개) 이중 나선: 중심 (6, 8), 반지름 3, 고도 5~15
const helix = Array.from({ length: N }, (_, k) => {
  const strand = k % 2, m = Math.floor(k / 2);
  const a = (m / 10) * 3 * Math.PI + strand * Math.PI;
  return r3([6 + 3 * Math.cos(a), 8 + 3 * Math.sin(a), 5 + (m * 10) / 9]);
});

export const CASES = [
  { id: 1, name: '평면 격자', desc: '착륙장 배치 그대로(1.5배 간격) 고도 8 m 로 상승', targets: grid, hidden: false },
  { id: 2, name: '원형', desc: '반지름 7 m 수평 링 — 교차 경로 발생', targets: ring, hidden: false },
  { id: 3, name: '글자 SJ', desc: '수직면(x-z) 위의 글자 모양', targets: letters, hidden: false },
  { id: 4, name: '구', desc: '반지름 4.5 m 구 — 진짜 3D 대형', targets: sphere, hidden: false },
  { id: 5, name: '비공개', desc: '채점할 때만 사용', targets: helix, hidden: true },
];

/** 학생 프로그램 stdin 으로 들어가는 입력 */
export function caseInput(c) {
  return { v_max: RULES.v_max, min_sep: RULES.min_sep, tol: RULES.tol, hold: RULES.hold, starts: STARTS, targets: c.targets };
}
