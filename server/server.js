/*
 * Drone OJ 서버
 *  - 정적 파일(public/) 제공. 2일차 화면은 공개 시각 전에는 닫힘 (관리자는 미리보기 가능)
 *  - 학번 가입/로그인, 프로젝트(코드) 저장, 제출 → 서버에서 학생 코드 실행·공식 채점, 실시간 리더보드(SSE), 관리자 API
 *
 * 환경 변수
 *   PORT            (기본 8080)
 *   ADMIN_PASSWORD  관리자 비밀번호 (없으면 시작할 때 무작위로 만들어 콘솔에 출력)
 *   DATA_DIR        SQLite 파일 위치 (기본 ./data)
 *   COOKIE_SECURE=1 항상 HTTPS 로만 쿠키 전송 (지정하지 않아도 HTTPS 로 들어온 요청은 자동으로 Secure)
 *   HTTPS_PORT      HTTPS 로도 받을 포트 (기본 8443). TLS_CERT_FILE · TLS_KEY_FILE 이 있을 때만 켜짐
 *   TLS_CERT_FILE / TLS_KEY_FILE  인증서 파일 (Docker 에서는 /certs/origin.pem · /certs/origin.key)
 *   JUDGE_WORKERS   동시에 채점하는 제출 수 (기본 10, 최대 16 = 격리 사용자 수)
 *   JUDGE_POOL      경로 검사 워커 수 (기본: CPU 수 − 1, 최대 4)
 *   JUDGE_TIMEOUT_SEC 케이스당 경로 계산 CPU 시간 제한 (기본 15초, 잠만 자는 코드는 × JUDGE_WALL_FACTOR(5) 벽시계로)
 *   JUDGE_MEM_MB    학생 프로그램 메모리 제한 (기본 1024MB, 리눅스)
 *   SANDBOX_USER    학생 코드를 실행할 사용자 이름 앞부분 (기본 sandbox → sandbox1 … sandbox16, root 로 실행 중일 때만) — sandbox.js 참고
 */
import express from 'express';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db, getSettings, setSetting, DEFAULT_SETTINGS, hashPassword, checkPassword, now, newToken } from './db.js';
import { CASES, PUBLIC_CASES, GRADED_CASES, caseInput, studentCaseName, RULES } from './cases.js';
import { validFiles } from './validate.js';
import { Grader, CPU_LIMIT_SEC } from './grader.js';
import { SANDBOX_INFO } from './sandbox.js';
import { DAY1_SOLUTIONS } from './day1-solutions.js';
import { SAMPLES as DAY2_SAMPLES, loadSample } from './day2-samples/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(__dirname, '../public');
const PORT = +process.env.PORT || 8080;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || crypto.randomBytes(6).toString('base64url');
const SESSION_DAYS = 14;
const grader = new Grader({
  size: +process.env.JUDGE_WORKERS || 0,
  // 케이스별 진행은 결과 화면이 1초마다 직접 확인하므로 모든 학생에게 알리지 않음
  onDone: (id, r) => {
    broadcast('judged', { id });
    if (!r) return;
    const u = db.prepare('SELECT u.name FROM submissions s JOIN users u ON u.id = s.user_id WHERE s.id = ?').get(id);
    broadcast('leaderboard');
    if (u) broadcast('submission', { name: u.name, passCount: r.passCount, total: GRADED_CASES.length });
  },
});

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(express.json({ limit: '5mb' })); // 큰 제출 본문은 /submit/finish 에서만 따로 받음

// ====================================================================== 공통
function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function setCookie(res, name, value, maxAgeSec) {
  // Cloudflare 등 HTTPS 로 들어온 요청(req.secure: X-Forwarded-Proto 포함)이면 자동으로 Secure
  const secure = process.env.COOKIE_SECURE === '1' || (res.req && res.req.secure) ? '; Secure' : '';
  res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`);
}
function session(req) {
  const c = cookies(req);
  const out = { user: null, admin: false };
  const cutoff = new Date(Date.now() - SESSION_DAYS * 864e5).toISOString();
  if (c.sid) {
    const r = db.prepare('SELECT u.id, u.student_id, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.is_admin = 0 AND s.created_at > ?').get(c.sid, cutoff);
    if (r) out.user = { id: r.id, studentId: r.student_id, name: r.name };
  }
  if (c.asid) out.admin = !!db.prepare('SELECT 1 FROM sessions WHERE token = ? AND is_admin = 1 AND created_at > ?').get(c.asid, cutoff);
  return out;
}
const err = (res, code, message) => res.status(code).json({ error: message });
const requireUser = (req, res, next) => { const s = session(req); if (!s.user) return err(res, 401, '로그인이 필요합니다'); req.user = s.user; req.isAdmin = s.admin; next(); };
const requireAdmin = (req, res, next) => { if (!session(req).admin) return err(res, 401, '관리자 로그인이 필요합니다'); next(); };
const ts = (iso) => (iso ? Date.parse(iso) : NaN);

function config() {
  const s = getSettings();
  const t = Date.now();
  const day2Open = !(ts(s.day2_open_at) > t);
  let lb = false;
  if (s.leaderboard_mode === 'open') lb = true;
  else if (s.leaderboard_mode === 'auto' && s.leaderboard_open_at && ts(s.leaderboard_open_at) <= t) lb = true;
  const deadlinePassed = !!s.submit_deadline && ts(s.submit_deadline) <= t;
  return {
    now: new Date(t).toISOString(),
    day2OpenAt: s.day2_open_at, day2Open,
    leaderboardOpen: lb, leaderboardOpenAt: s.leaderboard_mode === 'auto' ? s.leaderboard_open_at : '', leaderboardMode: s.leaderboard_mode,
    submitDeadline: s.submit_deadline, deadlinePassed,
    day1SolutionsOpen: s.day1_solutions === 'open',
  };
}
function day2Allowed(req) { return config().day2Open || session(req).admin; }

// ====================================================================== 실시간 알림 (SSE)
const clients = new Set();
app.get('/api/events', (req, res) => {
  // no-transform: Cloudflare 같은 프록시가 압축 · 버퍼링하지 않고 바로 흘려보내게
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(`event: hello\ndata: ${JSON.stringify(config())}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
});
function broadcast(event, data = {}) {
  if (event === 'leaderboard') lbCache.clear(); // 순위가 바뀔 수 있으면 다시 계산
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.write(msg);
}
setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 25000);
// 예약된 공개 시각이 지나면 알려 줌
let lastCfg = JSON.stringify(config());
setInterval(() => {
  const c = config(), s = JSON.stringify({ ...c, now: 0 });
  if (s !== lastCfg) { lastCfg = s; broadcast('config', c); broadcast('leaderboard'); }
}, 2000);

// ====================================================================== 화면 (공개 시각 게이트)
function closedPage(openAt) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>2일차 · 준비 중</title><link rel="stylesheet" href="/css/style.css"></head>
<body class="landing"><main class="land-wrap"><h1>2일차 챌린지는 아직 열리지 않았습니다</h1>
<p class="dim">공개 시각: <b id="t"></b></p><p><a class="btn" href="/">← 처음으로</a></p></main>
<script>document.getElementById('t').textContent=new Date(${JSON.stringify(openAt)}).toLocaleString('ko-KR');
setInterval(()=>fetch('/api/config').then(r=>r.json()).then(c=>{if(c.day2Open)location.reload()}),10000)</script></body></html>`;
}
app.use((req, res, next) => {
  if (/^\/day2(\/|$|\/index\.html)/.test(req.path) || req.path.startsWith('/js/day2/app')) {
    if (!day2Allowed(req)) {
      if (req.path.startsWith('/js/')) return res.status(404).end();
      return res.status(403).type('html').send(closedPage(getSettings().day2_open_at));
    }
  }
  next();
});
app.use(express.static(PUBLIC, {
  extensions: ['html'],
  setHeaders(res, p) {
    if (p.endsWith('.py')) res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
  },
}));

// ====================================================================== 공개 API
app.get('/api/config', (req, res) => res.json({ ...config(), admin: session(req).admin }));

// ---- 인증
const SID_RE = /^[0-9A-Za-z]{4,20}$/;
app.post('/api/auth/signup', async (req, res) => {
  const { studentId, name, password } = req.body || {};
  if (!day2Allowed(req)) return err(res, 403, '아직 가입할 수 없습니다');
  if (!SID_RE.test(studentId || '')) return err(res, 400, '학번은 4~20자의 숫자/영문이어야 합니다');
  if (!name || typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 20) return err(res, 400, '이름을 1~20자로 입력하세요');
  if (!password || String(password).length < 4) return err(res, 400, '비밀번호는 4자 이상이어야 합니다');
  if (db.prepare('SELECT 1 FROM users WHERE student_id = ?').get(studentId)) return err(res, 409, '이미 가입된 학번입니다. 비밀번호를 잊었다면 강사에게 초기화를 요청하세요');
  const pwHash = await hashPassword(String(password));
  // 해시를 계산하는 동안 같은 학번이 먼저 가입했을 수 있음 (UNIQUE)
  if (db.prepare('SELECT 1 FROM users WHERE student_id = ?').get(studentId)) return err(res, 409, '이미 가입된 학번입니다. 비밀번호를 잊었다면 강사에게 초기화를 요청하세요');
  const r = db.prepare('INSERT INTO users(student_id, name, pw_hash, created_at) VALUES (?, ?, ?, ?)').run(studentId, name.trim(), pwHash, now());
  const token = newToken();
  db.prepare('INSERT INTO sessions(token, user_id, created_at) VALUES (?, ?, ?)').run(token, r.lastInsertRowid, now());
  setCookie(res, 'sid', token, SESSION_DAYS * 86400);
  broadcast('leaderboard');
  res.json({ ok: true, user: { studentId, name: name.trim() } });
});
app.post('/api/auth/login', async (req, res) => {
  const { studentId, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE student_id = ?').get(String(studentId || ''));
  if (!u || !(await checkPassword(String(password || ''), u.pw_hash))) return err(res, 401, '학번 또는 비밀번호가 맞지 않습니다');
  const token = newToken();
  db.prepare('INSERT INTO sessions(token, user_id, created_at) VALUES (?, ?, ?)').run(token, u.id, now());
  setCookie(res, 'sid', token, SESSION_DAYS * 86400);
  res.json({ ok: true, user: { studentId: u.student_id, name: u.name } });
});
app.post('/api/auth/logout', (req, res) => {
  const c = cookies(req);
  if (c.sid) db.prepare('DELETE FROM sessions WHERE token = ?').run(c.sid);
  setCookie(res, 'sid', '', 0);
  res.json({ ok: true });
});
app.get('/api/auth/me', (req, res) => {
  const s = session(req);
  res.json({ user: s.user, admin: s.admin });
});
app.post('/api/auth/password', requireUser, async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!(await checkPassword(String(oldPassword || ''), u.pw_hash))) return err(res, 401, '현재 비밀번호가 맞지 않습니다');
  if (!newPassword || String(newPassword).length < 4) return err(res, 400, '새 비밀번호는 4자 이상이어야 합니다');
  db.prepare('UPDATE users SET pw_hash = ? WHERE id = ?').run(await hashPassword(String(newPassword)), u.id);
  res.json({ ok: true });
});

// ---- 1일차: 해설(정답) 예제 — 관리자가 공개하기 전에는 관리자에게만
app.get('/api/day1/solutions', (req, res) => {
  const open = config().day1SolutionsOpen;
  res.json({ open, solutions: open || session(req).admin ? DAY1_SOLUTIONS : [] });
});

// ---- 2일차: 문제 · 프로젝트
// 학생에게는 공개 케이스(PUBLIC_CASES)의 입력과, 채점 케이스(GRADED_CASES)의 이름(비공개는 번호만)만 줌
app.get('/api/day2/cases', (req, res) => {
  if (!day2Allowed(req)) return err(res, 403, '아직 공개되지 않았습니다');
  res.json({
    rules: RULES, timeLimitSec: CPU_LIMIT_SEC,
    cases: PUBLIC_CASES.map((c) => ({ id: c.id, name: c.name, desc: c.desc, graded: c.graded, input: caseInput(c) })),
    graded: GRADED_CASES.map((c) => ({ id: c.id, name: studentCaseName(c), hidden: !c.public })),
  });
});

app.get('/api/day2/project', requireUser, (req, res) => {
  const r = db.prepare('SELECT files, updated_at FROM projects WHERE user_id = ?').get(req.user.id);
  res.json(r ? { files: JSON.parse(r.files), updatedAt: r.updated_at } : { files: null });
});
app.put('/api/day2/project', requireUser, (req, res) => {
  const files = req.body && req.body.files;
  const bad = validFiles(files);
  if (bad) return err(res, 400, bad);
  const t = now();
  db.prepare('INSERT INTO projects(user_id, files, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET files = excluded.files, updated_at = excluded.updated_at').run(req.user.id, JSON.stringify(files), t);
  res.json({ ok: true, updatedAt: t });
});

// ---- 2일차: 제출 — 코드를 받아 서버에서 채점 케이스 7개(공개 2 + 비공개 5)를 실행·채점
app.post('/api/day2/submissions', requireUser, (req, res) => {
  const cfg = config();
  if (!cfg.day2Open && !req.isAdmin) return err(res, 403, '아직 공개되지 않았습니다');
  if (cfg.deadlinePassed) return err(res, 403, '제출이 마감되었습니다');
  const files = req.body && req.body.files;
  const bad = validFiles(files);
  if (bad) return err(res, 400, bad);
  const last = db.prepare('SELECT created_at FROM submissions WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(req.user.id);
  if (last && Date.now() - Date.parse(last.created_at) < 10_000) return err(res, 429, '제출은 10초에 한 번만 할 수 있습니다');
  if (db.prepare("SELECT 1 FROM submissions WHERE user_id = ? AND status = 'judging'").get(req.user.id)) return err(res, 429, '이전 제출을 아직 채점하고 있습니다. 끝난 뒤에 다시 제출하세요');
  const t = now();
  const waiting = JSON.stringify(GRADED_CASES.map((c) => ({ caseId: c.id, name: c.name, hidden: !c.public, state: 'WAIT' })));
  const id = Number(db.prepare("INSERT INTO submissions(user_id, created_at, files, results, ac_count, all_ac, total_time, status) VALUES (?, ?, ?, ?, 0, 0, NULL, 'judging')")
    .run(req.user.id, t, JSON.stringify(files), waiting).lastInsertRowid);
  grader.enqueue(id);
  res.status(202).json({ id, createdAt: t, status: 'judging', ahead: grader.ahead(id) });
});

// 학생에게 보여 줄 케이스 결과. 비공개 케이스는 입력(좌표·출력값)이 드러나지 않게 요약만
const CASE_BY_ID = new Map(CASES.map((c) => [c.id, c]));
const RV_TEXT = { format: () => '출력 형식 오류', speed: (r) => `속도 초과 (드론 ${r.drone})`, bounds: (r) => `비행 영역 이탈 (드론 ${r.drone})`, return: (r) => `미복귀 (드론 ${r.drone})`, formation: () => '대형 미완성 (모든 드론이 동시에 hold 초 이상 자기 목표에 있어야 함)', time: () => '미션 시간 초과', size: () => '출력이 너무 큼' };
function studentResult(r) {
  const c = CASE_BY_ID.get(r.caseId);
  const out = { caseId: r.caseId, name: c ? studentCaseName(c) : r.name, hidden: !!r.hidden, state: r.state || r.verdict, verdict: r.verdict || null, missionTime: r.missionTime ?? null, computeMs: r.computeMs ?? null };
  if (!r.hidden) return { ...out, message: r.message || '', kind: r.kind, collision: r.collision || null, drone: r.drone ?? null, t: r.t ?? null, errFile: r.errFile || null, errLine: r.errLine || null };
  const where = r.errFile ? ` (${r.errFile}${r.errLine ? ` ${r.errLine}번째 줄` : ''})` : '';
  const msg = {
    AC: () => `성공 · 미션 시간 ${(+r.missionTime).toFixed(2)} s`,
    COL: () => (r.collision ? `충돌: 드론 ${r.collision.i} 와 드론 ${r.collision.j}, t=${r.collision.t.toFixed(2)}s` : '충돌'),
    TLE: () => r.message,
    CE: () => `컴파일 에러: ${r.errType || 'SyntaxError'}${where}`,
    RE: () => `런타임 에러: ${r.errType || '예외'}${where} — 비공개 케이스라 자세한 메시지는 보여 주지 않습니다`,
    RV: () => (RV_TEXT[r.kind] || (() => r.message))(r),
  }[r.verdict];
  return { ...out, message: msg ? msg() : '', collision: r.collision ? { i: r.collision.i, j: r.collision.j, t: r.collision.t } : null };
}
const subRow = (r, student) => {
  const results = JSON.parse(r.results);
  return { id: r.id, createdAt: r.created_at, status: r.status, error: r.error, results: student ? results.map(studentResult) : results, passCount: r.ac_count, allAc: !!r.all_ac, totalTime: r.total_time, total: GRADED_CASES.length };
};
const SUB_COLS = 'id, created_at, status, error, results, ac_count, all_ac, total_time';
app.get('/api/day2/submissions/mine', requireUser, (req, res) => {
  const rows = db.prepare(`SELECT ${SUB_COLS} FROM submissions WHERE user_id = ? ORDER BY id DESC LIMIT 100`).all(req.user.id);
  res.json(rows.map((r) => subRow(r, true)));
});
// 채점 상황 (결과 화면이 1초마다 물어봄)
app.get('/api/day2/submissions/:id(\\d+)', requireUser, (req, res) => {
  const r = db.prepare(`SELECT ${SUB_COLS} FROM submissions WHERE id = ? AND user_id = ?`).get(+req.params.id, req.user.id);
  if (!r) return err(res, 404, '제출을 찾을 수 없습니다');
  res.json({ ...subRow(r, true), ahead: r.status === 'judging' ? grader.ahead(r.id) : 0 });
});
app.get('/api/day2/submissions/:id/files', requireUser, (req, res) => {
  const r = db.prepare('SELECT files FROM submissions WHERE id = ? AND user_id = ?').get(+req.params.id, req.user.id);
  if (!r) return err(res, 404, '제출을 찾을 수 없습니다');
  res.json({ files: JSON.parse(r.files) });
});

// ---- 리더보드
function maskId(s) { return s.length <= 4 ? s : s.slice(0, 4) + '*'.repeat(Math.max(0, s.length - 6)) + s.slice(-2); }
// 순위: ① 통과한 케이스 수(많을수록) ② 통과한 케이스의 미션 시간 합(작을수록) ③ 먼저 낸 제출. 학생마다 가장 좋은 제출 기준
const better = (a, b) => (a.ac_count !== b.ac_count ? a.ac_count > b.ac_count : (a.total_time ?? 0) !== (b.total_time ?? 0) ? (a.total_time ?? 0) < (b.total_time ?? 0) : a.id < b.id);
// 스코어보드는 바뀔 때(broadcast('leaderboard'))까지 계산 결과를 재사용 — 학생 수만큼 동시에 요청이 와도 한 번만 계산
const lbCache = new Map();
function leaderboard(full) {
  if (!lbCache.has(full)) lbCache.set(full, computeLeaderboard(full));
  return lbCache.get(full);
}
function computeLeaderboard(full) {
  const users = db.prepare('SELECT id, student_id, name FROM users').all();
  const subs = db.prepare("SELECT id, user_id, created_at, results, ac_count, all_ac, total_time FROM submissions WHERE status = 'done' ORDER BY id").all();
  // 2일차 공개 시각 이후에 낸 제출만 (공개 전 관리자 · 시험용 제출은 순위에서 뺌). 공개 시각을 바꾸면 바로 다시 계산됨
  const openAt = Date.parse(getSettings().day2_open_at);
  const by = new Map(users.map((u) => [u.id, { u, count: 0, best: null }]));
  for (const s of subs) {
    const e = by.get(s.user_id);
    if (!e) continue;
    if (Number.isFinite(openAt) && Date.parse(s.created_at) < openAt) continue;
    e.count++;
    if (!e.best || better(s, e.best)) e.best = s;
  }
  const rows = [...by.values()].filter((e) => e.best).sort((a, b) => (better(a.best, b.best) ? -1 : 1)).map((e, k) => {
    const s = e.best;
    const res = JSON.parse(s.results);
    return {
      rank: s.ac_count > 0 ? k + 1 : null,
      studentId: full ? e.u.student_id : maskId(e.u.student_id), name: e.u.name,
      passCount: s.ac_count, total: GRADED_CASES.length, totalTime: s.ac_count > 0 ? s.total_time : null, submissions: e.count, at: s.created_at,
      cases: GRADED_CASES.map((c) => { const r = res.find((x) => x.caseId === c.id) || {}; return { id: c.id, verdict: r.verdict || null, time: r.verdict === 'AC' ? r.missionTime : null }; }),
    };
  });
  return rows;
}
const lbCases = (full) => GRADED_CASES.map((c) => ({ id: c.id, name: full ? c.name : studentCaseName(c), hidden: !c.public }));
app.get('/api/leaderboard', (req, res) => {
  const cfg = config();
  const admin = session(req).admin;
  if (!cfg.leaderboardOpen && !admin) return res.json({ open: false, openAt: cfg.leaderboardOpenAt });
  res.json({ open: cfg.leaderboardOpen, preview: !cfg.leaderboardOpen, cases: lbCases(false), rows: leaderboard(false) });
});

// ====================================================================== 관리자 API
app.post('/api/admin/login', (req, res) => {
  const pw = String((req.body || {}).password || '');
  const a = Buffer.from(crypto.createHash('sha256').update(pw).digest('hex'));
  const b = Buffer.from(crypto.createHash('sha256').update(ADMIN_PASSWORD).digest('hex'));
  if (!crypto.timingSafeEqual(a, b)) return err(res, 401, '관리자 비밀번호가 맞지 않습니다');
  const token = newToken();
  db.prepare('INSERT INTO sessions(token, user_id, is_admin, created_at) VALUES (?, NULL, 1, ?)').run(token, now());
  setCookie(res, 'asid', token, SESSION_DAYS * 86400);
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => {
  const c = cookies(req);
  if (c.asid) db.prepare('DELETE FROM sessions WHERE token = ?').run(c.asid);
  setCookie(res, 'asid', '', 0);
  res.json({ ok: true });
});
app.get('/api/admin/settings', requireAdmin, (req, res) => res.json({ settings: getSettings(), config: config() }));
app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const body = req.body || {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (!(k in body)) continue;
    const v = String(body[k] ?? '');
    if (k === 'leaderboard_mode') { if (!['auto', 'open', 'closed'].includes(v)) return err(res, 400, 'leaderboard_mode 는 auto/open/closed'); }
    else if (k === 'day1_solutions') { if (!['open', 'closed'].includes(v)) return err(res, 400, 'day1_solutions 는 open/closed'); }
    else if (v && Number.isNaN(Date.parse(v))) return err(res, 400, `${k}: 날짜 형식이 올바르지 않습니다`);
    setSetting(k, v);
  }
  const c = config();
  broadcast('config', c);
  broadcast('leaderboard');
  res.json({ settings: getSettings(), config: c });
});
app.get('/api/admin/users', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.student_id, u.name, u.created_at,
      (SELECT COUNT(*) FROM submissions s WHERE s.user_id = u.id) AS submissions,
      (SELECT MAX(ac_count) FROM submissions s WHERE s.user_id = u.id) AS best_ac,
      (SELECT MIN(total_time) FROM submissions s WHERE s.user_id = u.id AND s.all_ac = 1) AS best_time,
      (SELECT MAX(created_at) FROM submissions s WHERE s.user_id = u.id) AS last_submit,
      (SELECT updated_at FROM projects p WHERE p.user_id = u.id) AS project_updated
    FROM users u ORDER BY u.student_id`).all();
  res.json(rows.map((r) => ({ ...r, graded_total: GRADED_CASES.length })));
});
app.get('/api/admin/users/:id', requireAdmin, (req, res) => {
  const u = db.prepare('SELECT id, student_id, name, created_at FROM users WHERE id = ?').get(+req.params.id);
  if (!u) return err(res, 404, '없는 사용자입니다');
  const p = db.prepare('SELECT files, updated_at FROM projects WHERE user_id = ?').get(u.id);
  const subs = db.prepare(`SELECT ${SUB_COLS} FROM submissions WHERE user_id = ? ORDER BY id DESC`).all(u.id);
  res.json({
    user: u, project: p ? { files: JSON.parse(p.files), updatedAt: p.updated_at } : null,
    submissions: subs.map((s) => subRow(s, false)),
  });
});
app.get('/api/admin/submissions/:id/files', requireAdmin, (req, res) => {
  const r = db.prepare('SELECT files FROM submissions WHERE id = ?').get(+req.params.id);
  if (!r) return err(res, 404, '제출을 찾을 수 없습니다');
  res.json({ files: JSON.parse(r.files) });
});
app.post('/api/admin/users/:id/reset-password', requireAdmin, async (req, res) => {
  const r = db.prepare('UPDATE users SET pw_hash = ? WHERE id = ?').run(await hashPassword('0000'), +req.params.id);
  if (!r.changes) return err(res, 404, '없는 사용자입니다');
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(+req.params.id);
  res.json({ ok: true });
});
app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const r = db.prepare('DELETE FROM users WHERE id = ?').run(+req.params.id);
  if (!r.changes) return err(res, 404, '없는 사용자입니다');
  broadcast('leaderboard');
  res.json({ ok: true });
});
app.get('/api/admin/submissions', requireAdmin, (req, res) => {
  const rows = db.prepare(`SELECT s.id, s.created_at, s.status, s.error, s.ac_count, s.all_ac, s.total_time, s.results, u.student_id, u.name, u.id AS user_id
    FROM submissions s JOIN users u ON u.id = s.user_id ORDER BY s.id DESC LIMIT 200`).all();
  res.json(rows.map((r) => ({ ...r, results: JSON.parse(r.results) })));
});
app.get('/api/admin/leaderboard', requireAdmin, (req, res) => res.json({ cases: lbCases(true), rows: leaderboard(true) }));
// 2일차 관리자 테스트 코드 (2일차 화면의 '🔧 테스트 코드' 버튼)
app.get('/api/admin/day2-samples', requireAdmin, (req, res) => res.json(DAY2_SAMPLES));
app.get('/api/admin/day2-samples/:id', requireAdmin, (req, res) => {
  const s = loadSample(String(req.params.id));
  if (!s) return err(res, 404, '없는 테스트 코드입니다');
  res.json(s);
});
app.get('/api/admin/cases', requireAdmin, (req, res) => res.json(CASES.map((c) => ({ id: c.id, name: c.name, desc: c.desc, hidden: !c.public, graded: c.graded, input: caseInput(c) }))));

app.use('/api', (req, res) => err(res, 404, '없는 API 입니다'));
// 본문 크기 초과 등 express 오류를 JSON 으로
app.use((e, req, res, next) => {
  if (res.headersSent) return next(e);
  if (e.type === 'entity.too.large') return err(res, 413, '보낸 데이터가 너무 큽니다');
  if (e.type === 'entity.parse.failed') return err(res, 400, '요청 형식(JSON)이 올바르지 않습니다');
  console.error(e);
  err(res, 500, '서버 오류');
});

// async 핸들러에서 놓친 예외가 서버 전체를 끄지 않게 (기록만 남김)
process.on('unhandledRejection', (e) => console.error('처리되지 않은 오류:', e));

// 서버가 다시 시작되면 채점 중이던 제출을 처음부터 다시 채점 (코드는 제출할 때 저장해 둠)
for (const r of db.prepare("SELECT id FROM submissions WHERE status = 'judging' ORDER BY id").all()) grader.enqueue(r.id);

app.listen(PORT, () => {
  console.log(`Drone OJ 서버: http://localhost:${PORT}`);
  const cert = process.env.TLS_CERT_FILE, key = process.env.TLS_KEY_FILE;
  if (cert && key && fs.existsSync(cert) && fs.existsSync(key)) {
    const HTTPS_PORT = +process.env.HTTPS_PORT || 8443;
    https.createServer({ cert: fs.readFileSync(cert), key: fs.readFileSync(key) }, app)
      .listen(HTTPS_PORT, () => console.log(`HTTPS: 포트 ${HTTPS_PORT} (인증서 ${cert})`));
  }
  if (!process.env.ADMIN_PASSWORD) console.log(`⚠ ADMIN_PASSWORD 가 설정되지 않아 임시 관리자 비밀번호를 만들었습니다: ${ADMIN_PASSWORD}`);
  console.log(`2일차 공개 시각: ${getSettings().day2_open_at} · 동시 채점 ${grader.size}개 · 케이스당 CPU ${CPU_LIMIT_SEC}초`);
  console.log(`학생 코드 실행: ${SANDBOX_INFO}`);
});
