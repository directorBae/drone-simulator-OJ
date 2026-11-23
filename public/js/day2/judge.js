/*
 * 2일차 군집 경로 채점기 — 브라우저(즉시 피드백·리플레이)와 서버(공식 채점)가 같은 코드를 씁니다.
 *
 * 입력(학생 프로그램의 stdin):  { "v_max", "starts": [[x,y,z]×20], "targets": [[x,y,z]×20], "min_sep", "tol", "hold" }
 * 출력(학생 프로그램의 stdout): { "paths": [ [[t,x,y,z], ...] × 20 ] }   좌표: m, z 는 위가 +
 *
 * 규칙
 *  - 형식: paths 는 드론 수만큼, 각 경로는 [t,x,y,z] 2개 이상, t 는 0 에서 시작해 엄격히 증가
 *  - 시작: 첫 웨이포인트 = 자기 착륙 지점 (starts[i]),  끝: 마지막 웨이포인트 = 자기 착륙 지점 (z = 0)
 *  - 웨이포인트 사이는 직선 등속 보간. 마지막 웨이포인트 이후에는 그 자리에 정지
 *  - 속도: 모든 구간에서 속력 ≤ v_max
 *  - 영역: z ≥ 0, BOUNDS 안
 *  - 충돌: 두 드론의 중심이 max(|Δx|,|Δy|,|Δz|) < min_sep (0.3) 이 되는 순간이 있으면 충돌 (해석적으로 정확히 검사)
 *  - 대형: 20개 목표점이 모두 (각각 어떤 드론이든) tol 이내로 동시에 hold 초 이상 채워져야 함 (할당 자유)
 *  - 미션 시간 = 마지막 드론이 착륙한 시각 (= 마지막 웨이포인트 t 의 최댓값)
 */
export const BOUNDS = { x: [-30, 40], y: [-30, 40], z: [0, 40] };
export const MAX_MISSION_TIME = 300;
export const MAX_WAYPOINTS = 20000;
export const VERDICT_NAMES = { AC: '성공', COL: '충돌 에러', RV: '규칙 위반', CE: '컴파일 에러', RE: '런타임 에러', TLE: '시간 초과', PENDING: '채점 중' };
const EPS = 1e-6;
const f2 = (v) => (Math.round(v * 100) / 100).toString();
const fp = (p) => `(${p.map(f2).join(', ')})`;

/** 프로그램 출력에서 JSON 을 찾아냄 (디버그 print 가 섞여 있어도 마지막 줄의 JSON 을 시도) */
export function parseOutput(text) {
  const s = (text || '').trim();
  if (!s) return { error: '출력이 비어 있습니다. print(json.dumps({"paths": paths})) 로 결과를 출력하세요.' };
  try { return { value: JSON.parse(s) }; } catch (e) { /* 아래에서 다시 시도 */ }
  const lines = s.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i][0] !== '{') continue;
    try { return { value: JSON.parse(lines[i]) }; } catch (e) { /* continue */ }
  }
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return { value: JSON.parse(s.slice(a, b + 1)) }; } catch (e) { /* fallthrough */ } }
  let msg = '';
  try { JSON.parse(s); } catch (e) { msg = e.message; }
  return { error: `출력이 올바른 JSON 이 아닙니다 (${msg}). 디버그 출력은 print(..., file=sys.stderr) 를 쓰세요.` };
}

/** 경로 위 t 시각의 위치 (직선 보간, 끝난 뒤에는 정지) */
export function positionAt(path, t) {
  if (t <= path[0][0]) return [path[0][1], path[0][2], path[0][3]];
  const n = path.length;
  if (t >= path[n - 1][0]) { const w = path[n - 1]; return [w[1], w[2], w[3]]; }
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (path[mid][0] <= t) lo = mid; else hi = mid; }
  const a = path[lo], b = path[hi];
  const u = (t - a[0]) / (b[0] - a[0]);
  return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u];
}

function fail(verdict, kind, message, extra = {}) { return { verdict, kind, message, ...extra }; }

/** 형식 검사 + 정규화. 실패하면 {error} */
export function validateFormat(input, value) {
  const N = input.starts.length;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: '최상위는 {"paths": [...]} 형태의 객체여야 합니다.' };
  const paths = value.paths;
  if (!Array.isArray(paths)) return { error: '"paths" 키가 없거나 리스트가 아닙니다.' };
  if (paths.length !== N) return { error: `paths 에는 드론 ${N}대의 경로가 있어야 합니다 (받은 개수: ${paths.length}).` };
  const out = [];
  for (let i = 0; i < N; i++) {
    const p = paths[i];
    if (!Array.isArray(p) || p.length < 2) return { error: `드론 ${i}: 경로는 웨이포인트 2개 이상인 리스트여야 합니다.`, drone: i };
    if (p.length > MAX_WAYPOINTS) return { error: `드론 ${i}: 웨이포인트가 너무 많습니다 (최대 ${MAX_WAYPOINTS}개).`, drone: i };
    const q = [];
    for (let k = 0; k < p.length; k++) {
      const w = p[k];
      if (!Array.isArray(w) || w.length !== 4 || !w.every((x) => typeof x === 'number' && Number.isFinite(x))) {
        return { error: `드론 ${i}, ${k}번째 웨이포인트: [t, x, y, z] 숫자 4개여야 합니다 (받은 값: ${JSON.stringify(w)?.slice(0, 60)}).`, drone: i };
      }
      if (k > 0 && !(w[0] > q[k - 1][0])) return { error: `드론 ${i}, ${k}번째 웨이포인트: t 는 증가해야 합니다 (t=${w[0]}, 이전 t=${q[k - 1][0]}).`, drone: i };
      q.push(w.slice());
    }
    if (Math.abs(q[0][0]) > EPS) return { error: `드론 ${i}: 첫 웨이포인트의 t 는 0 이어야 합니다 (받은 값: ${q[0][0]}).`, drone: i };
    const s = input.starts[i];
    if (Math.max(Math.abs(q[0][1] - s[0]), Math.abs(q[0][2] - s[1]), Math.abs(q[0][3] - s[2])) > 1e-3) {
      return { error: `드론 ${i}: 첫 웨이포인트는 자기 착륙 지점 ${fp(s)} 이어야 합니다 (받은 값: ${fp(q[0].slice(1))}).`, drone: i };
    }
    out.push(q);
  }
  return { paths: out };
}

/** 두 드론의 가장 이른 충돌 시각 (없으면 null) — 구간별 상대 운동이 직선이므로 축마다 정확히 풀이 */
function firstCollision(pa, pb, m) {
  const times = [];
  let i = 0, j = 0;
  while (i < pa.length || j < pb.length) {
    const ta = i < pa.length ? pa[i][0] : Infinity, tb = j < pb.length ? pb[j][0] : Infinity;
    const t = Math.min(ta, tb);
    if (!times.length || t > times[times.length - 1] + 1e-12) times.push(t);
    if (ta === t) i++;
    if (tb === t) j++;
  }
  times.push(times[times.length - 1] + 1); // 둘 다 정지한 뒤 구간
  let A0 = positionAt(pa, times[0]), B0 = positionAt(pb, times[0]);
  for (let k = 0; k + 1 < times.length; k++) {
    const t0 = times[k], t1 = times[k + 1], L = t1 - t0;
    const A1 = positionAt(pa, t1), B1 = positionAt(pb, t1);
    let lo = 0, hi = L;
    for (let a = 0; a < 3 && lo < hi; a++) {
      const d0 = A0[a] - B0[a], w = ((A1[a] - B1[a]) - d0) / L;
      if (Math.abs(w) < 1e-12) { if (!(Math.abs(d0) < m)) hi = -1; continue; }
      const s1 = (-m - d0) / w, s2 = (m - d0) / w;
      lo = Math.max(lo, Math.min(s1, s2)); hi = Math.min(hi, Math.max(s1, s2));
    }
    if (hi - lo > 1e-9) {
      const t = t0 + lo;
      const pA = positionAt(pa, t), pB = positionAt(pb, t);
      return { t, pos: pA.map((v, a) => (v + pB[a]) / 2), posA: pA, posB: pB };
    }
    A0 = A1; B0 = B1;
  }
  return null;
}

/** 경로가 점 c 에서 r 이내인 시간 구간들 */
function nearIntervals(path, c, r) {
  const out = [];
  for (let k = 0; k + 1 < path.length; k++) {
    const [t0, x0, y0, z0] = path[k], [t1, x1, y1, z1] = path[k + 1];
    const L = t1 - t0;
    const v = [(x1 - x0) / L, (y1 - y0) / L, (z1 - z0) / L];
    const d = [x0 - c[0], y0 - c[1], z0 - c[2]];
    const a = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
    const b = 2 * (v[0] * d[0] + v[1] * d[1] + v[2] * d[2]);
    const c0 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] - r * r;
    if (a < 1e-12) { if (c0 <= 0) out.push([t0, t1]); continue; }
    const disc = b * b - 4 * a * c0;
    if (disc < 0) continue;
    const sq = Math.sqrt(disc);
    const s1 = Math.max(0, (-b - sq) / (2 * a)), s2 = Math.min(L, (-b + sq) / (2 * a));
    if (s2 >= s1) out.push([t0 + s1, t0 + s2]);
  }
  const last = path[path.length - 1];
  if (Math.hypot(last[1] - c[0], last[2] - c[1], last[3] - c[2]) <= r) out.push([last[0], Infinity]);
  return out;
}
function mergeIntervals(list) {
  list.sort((p, q) => p[0] - q[0]);
  const out = [];
  for (const iv of list) {
    if (out.length && iv[0] <= out[out.length - 1][1] + 1e-9) out[out.length - 1][1] = Math.max(out[out.length - 1][1], iv[1]);
    else out.push(iv.slice());
  }
  return out;
}
function intersectIntervals(A, B) {
  const out = [];
  let i = 0, j = 0;
  while (i < A.length && j < B.length) {
    const lo = Math.max(A[i][0], B[j][0]), hi = Math.min(A[i][1], B[j][1]);
    if (hi >= lo) out.push([lo, hi]);
    if (A[i][1] < B[j][1]) i++; else j++;
  }
  return out;
}

/**
 * 한 테스트 케이스 채점.  input: 케이스 입력,  stdout: 프로그램 출력 문자열
 * 반환: { verdict: 'AC'|'COL'|'RV', kind, message, missionTime?, collision?, formation?, paths? }
 */
export function judgeCase(input, stdout) {
  const N = input.starts.length;
  const vmax = input.v_max, sep = input.min_sep ?? 0.3, tol = input.tol ?? 0.1, hold = input.hold ?? 1.0;
  const parsed = parseOutput(stdout);
  if (parsed.error) return fail('RV', 'format', '형식 오류: ' + parsed.error);
  const fmt = validateFormat(input, parsed.value);
  if (fmt.error) return fail('RV', 'format', '형식 오류: ' + fmt.error, { drone: fmt.drone });
  const paths = fmt.paths;
  const base = { paths };

  // 영역 · 속도 · 복귀
  for (let i = 0; i < N; i++) {
    const p = paths[i];
    for (let k = 0; k < p.length; k++) {
      const [t, x, y, z] = p[k];
      if (z < -EPS || x < BOUNDS.x[0] || x > BOUNDS.x[1] || y < BOUNDS.y[0] || y > BOUNDS.y[1] || z > BOUNDS.z[1]) {
        return fail('RV', 'bounds', `비행 영역 위반: 드론 ${i} 가 t=${f2(t)}s 에 ${fp([x, y, z])} — 허용 범위 x ${BOUNDS.x.join('~')}, y ${BOUNDS.y.join('~')}, z 0~${BOUNDS.z[1]}`, { ...base, drone: i, t, at: [x, y, z] });
      }
      if (k > 0) {
        const q = p[k - 1];
        const dist = Math.hypot(x - q[1], y - q[2], z - q[3]), dt = t - q[0];
        const v = dist / dt;
        if (v > vmax * (1 + 1e-9) + 1e-9) {
          return fail('RV', 'speed', `속도 초과: 드론 ${i} 의 t=${f2(q[0])}~${f2(t)}s 구간 속력 ${v.toFixed(3)} m/s > v_max ${vmax} m/s`, { ...base, drone: i, t: q[0], at: q.slice(1) });
        }
      }
    }
    const last = p[p.length - 1], s = input.starts[i];
    if (Math.max(Math.abs(last[1] - s[0]), Math.abs(last[2] - s[1])) > 1e-3 || Math.abs(last[3]) > 1e-3) {
      return fail('RV', 'return', `미복귀: 드론 ${i} 의 마지막 웨이포인트 ${fp(last.slice(1))} 가 자기 착륙 지점 ${fp([s[0], s[1], 0])} 이 아닙니다.`, { ...base, drone: i, t: last[0], at: last.slice(1) });
    }
  }
  const missionTime = Math.max(...paths.map((p) => p[p.length - 1][0]));
  if (missionTime > MAX_MISSION_TIME) return fail('RV', 'time', `미션 시간 ${f2(missionTime)}s 가 최대 ${MAX_MISSION_TIME}s 를 넘습니다.`, { ...base, missionTime });

  // 충돌
  let col = null;
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const c = firstCollision(paths[i], paths[j], sep);
      if (c && (!col || c.t < col.t)) col = { ...c, i, j };
    }
  }
  if (col) {
    return fail('COL', 'collision', `충돌: 드론 ${col.i} 와 드론 ${col.j} 가 t=${col.t.toFixed(3)}s 에 ${fp(col.pos)} 부근에서 충돌 (Chebyshev 거리 < ${sep})`, { ...base, missionTime, collision: col });
  }

  // 대형
  let common = [[-Infinity, Infinity]];
  const never = [];
  input.targets.forEach((c, k) => {
    const u = mergeIntervals(paths.flatMap((p) => nearIntervals(p, c, tol)));
    if (!u.length) never.push(k);
    common = intersectIntervals(common, u);
  });
  const best = common.reduce((m, iv) => Math.max(m, Math.min(iv[1], missionTime) - iv[0]), 0);
  const ok = common.find((iv) => iv[1] - iv[0] >= hold - 1e-9);
  if (!ok) {
    const why = never.length
      ? `한 번도 채워지지 않은 목표점 ${never.length}개 (번호: ${never.slice(0, 8).join(', ')}${never.length > 8 ? ' …' : ''})`
      : `모든 목표점이 동시에 채워진 최대 시간 ${f2(Math.max(best, 0))}s`;
    return fail('RV', 'formation', `대형 미완성: 20개 목표점을 오차 ${tol} m 이내로 동시에 ${hold}s 이상 채워야 합니다 — ${why}`, { ...base, missionTime, never });
  }
  return { verdict: 'AC', kind: 'ok', message: `성공! 미션 시간 ${missionTime.toFixed(2)}s (대형 완성 t=${f2(ok[0])}s)`, missionTime, formation: { t: ok[0] }, paths };
}
