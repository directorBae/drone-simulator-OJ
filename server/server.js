/*
 * Drone OJ 서버
 *  - 정적 파일(public/) 제공. 2일차 화면은 공개 시각 전에는 닫힘 (관리자는 미리보기 가능)
 *  - 학번 가입/로그인, 프로젝트(코드) 저장, 제출·공식 채점, 실시간 리더보드(SSE), 관리자 API
 *
 * 환경 변수
 *   PORT            (기본 8080)
 *   ADMIN_PASSWORD  관리자 비밀번호 (없으면 시작할 때 무작위로 만들어 콘솔에 출력)
 *   DATA_DIR        SQLite 파일 위치 (기본 ./data)
 *   COOKIE_SECURE=1 HTTPS 로만 쿠키 전송 (HTTPS 뒤에서 운영할 때)
 */
import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db, getSettings, setSetting, DEFAULT_SETTINGS, hashPassword, checkPassword, now, newToken } from './db.js';
import { CASES, caseInput, STARTS, RULES } from './cases.js';
import { judgeCase, VERDICT_NAMES } from '../public/js/day2/judge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(__dirname, '../public');
const PORT = +process.env.PORT || 8080;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || crypto.randomBytes(6).toString('base64url');
const SESSION_DAYS = 14;
const MAX_PROJECT_BYTES = 1_000_000, MAX_FILES = 100;
const MAX_STDOUT = 8_000_000;

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(express.json({ limit: '45mb' }));

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
  const secure = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
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
  };
}
function day2Allowed(req) { return config().day2Open || session(req).admin; }

// ====================================================================== 실시간 알림 (SSE)
const clients = new Set();
app.get('/api/events', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(`event: hello\ndata: ${JSON.stringify(config())}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
});
function broadcast(event, data = {}) {
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
app.post('/api/auth/signup', (req, res) => {
  const { studentId, name, password } = req.body || {};
  if (!day2Allowed(req)) return err(res, 403, '아직 가입할 수 없습니다');
  if (!SID_RE.test(studentId || '')) return err(res, 400, '학번은 4~20자의 숫자/영문이어야 합니다');
  if (!name || typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 20) return err(res, 400, '이름을 1~20자로 입력하세요');
  if (!password || String(password).length < 4) return err(res, 400, '비밀번호는 4자 이상이어야 합니다');
  if (db.prepare('SELECT 1 FROM users WHERE student_id = ?').get(studentId)) return err(res, 409, '이미 가입된 학번입니다. 비밀번호를 잊었다면 강사에게 초기화를 요청하세요');
  const r = db.prepare('INSERT INTO users(student_id, name, pw_hash, created_at) VALUES (?, ?, ?, ?)').run(studentId, name.trim(), hashPassword(String(password)), now());
  const token = newToken();
  db.prepare('INSERT INTO sessions(token, user_id, created_at) VALUES (?, ?, ?)').run(token, r.lastInsertRowid, now());
  setCookie(res, 'sid', token, SESSION_DAYS * 86400);
  broadcast('leaderboard');
  res.json({ ok: true, user: { studentId, name: name.trim() } });
});
app.post('/api/auth/login', (req, res) => {
  const { studentId, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE student_id = ?').get(String(studentId || ''));
  if (!u || !checkPassword(String(password || ''), u.pw_hash)) return err(res, 401, '학번 또는 비밀번호가 맞지 않습니다');
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
app.post('/api/auth/password', requireUser, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!checkPassword(String(oldPassword || ''), u.pw_hash)) return err(res, 401, '현재 비밀번호가 맞지 않습니다');
  if (!newPassword || String(newPassword).length < 4) return err(res, 400, '새 비밀번호는 4자 이상이어야 합니다');
  db.prepare('UPDATE users SET pw_hash = ? WHERE id = ?').run(hashPassword(String(newPassword)), u.id);
  res.json({ ok: true });
});

// ---- 2일차: 문제 · 프로젝트
const publicCase = (c) => ({ id: c.id, name: c.name, desc: c.desc, hidden: c.hidden, input: c.hidden ? null : caseInput(c) });
app.get('/api/day2/cases', (req, res) => {
  if (!day2Allowed(req)) return err(res, 403, '아직 공개되지 않았습니다');
  res.json({ rules: RULES, starts: STARTS, cases: CASES.map(publicCase) });
});

function validFiles(files) {
  if (!files || typeof files !== 'object' || Array.isArray(files)) return '파일 목록 형식이 올바르지 않습니다';
  const entries = Object.entries(files);
  if (entries.length > MAX_FILES) return `파일은 최대 ${MAX_FILES}개까지 저장할 수 있습니다`;
  let size = 0;
  for (const [p, c] of entries) {
    if (typeof c !== 'string') return `${p}: 내용이 문자열이 아닙니다`;
    if (!/^[\w\-. /가-힣]+$/.test(p) || p.includes('..') || p.startsWith('/') || p.length > 200) return `파일 경로 '${p}' 를 쓸 수 없습니다`;
    size += p.length + c.length;
  }
  if (size > MAX_PROJECT_BYTES) return `프로젝트 크기가 ${MAX_PROJECT_BYTES / 1e6}MB 를 넘습니다`;
  if (!('main.py' in files)) return 'main.py 가 필요합니다';
  return null;
}
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

// ---- 2일차: 제출 (브라우저에서 실행 → 서버가 공식 채점)
app.post('/api/day2/submit/start', requireUser, (req, res) => {
  const cfg = config();
  if (!cfg.day2Open && !req.isAdmin) return err(res, 403, '아직 공개되지 않았습니다');
  if (cfg.deadlinePassed) return err(res, 403, '제출이 마감되었습니다');
  const last = db.prepare('SELECT created_at FROM submissions WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(req.user.id);
  if (last && Date.now() - Date.parse(last.created_at) < 10_000) return err(res, 429, '제출은 10초에 한 번만 할 수 있습니다');
  db.prepare('DELETE FROM submit_tokens WHERE user_id = ?').run(req.user.id);
  const token = newToken();
  db.prepare('INSERT INTO submit_tokens(token, user_id, created_at) VALUES (?, ?, ?)').run(token, req.user.id, now());
  res.json({ token, cases: CASES.map((c) => ({ id: c.id, name: c.name, hidden: c.hidden, input: caseInput(c) })) });
});
app.post('/api/day2/submit/finish', requireUser, (req, res) => {
  const { token, files, results } = req.body || {};
  const tk = db.prepare('SELECT * FROM submit_tokens WHERE token = ? AND user_id = ?').get(String(token || ''), req.user.id);
  if (!tk) return err(res, 400, '제출 토큰이 올바르지 않습니다. 다시 제출하세요');
  db.prepare('DELETE FROM submit_tokens WHERE token = ?').run(tk.token);
  if (Date.now() - Date.parse(tk.created_at) > 30 * 60_000) return err(res, 400, '제출 시간이 너무 오래 걸렸습니다. 다시 제출하세요');
  const bad = validFiles(files);
  if (bad) return err(res, 400, bad);
  if (!Array.isArray(results)) return err(res, 400, 'results 가 없습니다');

  const judged = CASES.map((c) => {
    const r = results.find((x) => x && x.caseId === c.id) || { status: 'RE', error: '실행 결과가 없습니다' };
    const base = { caseId: c.id, name: c.name, hidden: c.hidden, ms: Math.round(+r.ms || 0) };
    if (r.status === 'CE' || r.status === 'RE' || r.status === 'TLE') {
      return { ...base, verdict: r.status, message: String(r.error || VERDICT_NAMES[r.status]).slice(0, 2000) };
    }
    const out = String(r.stdout || '');
    if (out.length > MAX_STDOUT) return { ...base, verdict: 'RV', message: '출력이 너무 큽니다' };
    const j = judgeCase(caseInput(c), out);
    return { ...base, verdict: j.verdict, kind: j.kind, message: j.message, missionTime: j.missionTime ?? null, collision: j.collision ? { i: j.collision.i, j: j.collision.j, t: j.collision.t, pos: j.collision.pos } : null };
  });
  const acCount = judged.filter((r) => r.verdict === 'AC').length;
  const allAc = acCount === CASES.length;
  const total = allAc ? judged.reduce((s, r) => s + r.missionTime, 0) : null;
  const t = now();
  const ins = db.prepare('INSERT INTO submissions(user_id, created_at, files, results, ac_count, all_ac, total_time) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(req.user.id, t, JSON.stringify(files), JSON.stringify(judged), acCount, allAc ? 1 : 0, total);
  broadcast('leaderboard');
  broadcast('submission', { name: req.user.name, acCount, allAc });
  res.json({ id: Number(ins.lastInsertRowid), createdAt: t, results: judged, acCount, allAc, totalTime: total });
});
app.get('/api/day2/submissions/mine', requireUser, (req, res) => {
  const rows = db.prepare('SELECT id, created_at, results, ac_count, all_ac, total_time FROM submissions WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(req.user.id);
  res.json(rows.map((r) => ({ id: r.id, createdAt: r.created_at, results: JSON.parse(r.results), acCount: r.ac_count, allAc: !!r.all_ac, totalTime: r.total_time })));
});
app.get('/api/day2/submissions/:id/files', requireUser, (req, res) => {
  const r = db.prepare('SELECT files FROM submissions WHERE id = ? AND user_id = ?').get(+req.params.id, req.user.id);
  if (!r) return err(res, 404, '제출을 찾을 수 없습니다');
  res.json({ files: JSON.parse(r.files) });
});

// ---- 리더보드
function maskId(s) { return s.length <= 4 ? s : s.slice(0, 4) + '*'.repeat(Math.max(0, s.length - 6)) + s.slice(-2); }
function leaderboard(full) {
  const users = db.prepare('SELECT id, student_id, name FROM users').all();
  const subs = db.prepare('SELECT id, user_id, created_at, results, ac_count, all_ac, total_time FROM submissions ORDER BY id').all();
  const by = new Map(users.map((u) => [u.id, { u, count: 0, best: null, bestPartial: null }]));
  for (const s of subs) {
    const e = by.get(s.user_id);
    if (!e) continue;
    e.count++;
    if (s.all_ac && (!e.best || s.total_time < e.best.total_time)) e.best = s;
    if (!e.bestPartial || s.ac_count > e.bestPartial.ac_count) e.bestPartial = s;
  }
  const rows = [...by.values()].filter((e) => e.count > 0).map((e) => {
    const s = e.best || e.bestPartial;
    const res = JSON.parse(s.results);
    return {
      studentId: full ? e.u.student_id : maskId(e.u.student_id), name: e.u.name,
      ranked: !!e.best, totalTime: e.best ? e.best.total_time : null, acCount: s.ac_count, submissions: e.count,
      at: s.created_at, cases: res.map((r) => ({ id: r.caseId, verdict: r.verdict, time: r.missionTime ?? null })),
    };
  });
  rows.sort((a, b) => (b.ranked - a.ranked) || (a.ranked ? a.totalTime - b.totalTime || a.at.localeCompare(b.at) : b.acCount - a.acCount || a.at.localeCompare(b.at)));
  let rank = 0;
  for (const r of rows) r.rank = r.ranked ? ++rank : null;
  return rows;
}
app.get('/api/leaderboard', (req, res) => {
  const cfg = config();
  const admin = session(req).admin;
  if (!cfg.leaderboardOpen && !admin) return res.json({ open: false, openAt: cfg.leaderboardOpenAt });
  res.json({ open: cfg.leaderboardOpen, preview: !cfg.leaderboardOpen, cases: CASES.map((c) => ({ id: c.id, name: c.name })), rows: leaderboard(false) });
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
  res.json(rows);
});
app.get('/api/admin/users/:id', requireAdmin, (req, res) => {
  const u = db.prepare('SELECT id, student_id, name, created_at FROM users WHERE id = ?').get(+req.params.id);
  if (!u) return err(res, 404, '없는 사용자입니다');
  const p = db.prepare('SELECT files, updated_at FROM projects WHERE user_id = ?').get(u.id);
  const subs = db.prepare('SELECT id, created_at, results, ac_count, all_ac, total_time FROM submissions WHERE user_id = ? ORDER BY id DESC').all(u.id);
  res.json({
    user: u, project: p ? { files: JSON.parse(p.files), updatedAt: p.updated_at } : null,
    submissions: subs.map((s) => ({ id: s.id, createdAt: s.created_at, results: JSON.parse(s.results), acCount: s.ac_count, allAc: !!s.all_ac, totalTime: s.total_time })),
  });
});
app.get('/api/admin/submissions/:id/files', requireAdmin, (req, res) => {
  const r = db.prepare('SELECT files FROM submissions WHERE id = ?').get(+req.params.id);
  if (!r) return err(res, 404, '제출을 찾을 수 없습니다');
  res.json({ files: JSON.parse(r.files) });
});
app.post('/api/admin/users/:id/reset-password', requireAdmin, (req, res) => {
  const r = db.prepare('UPDATE users SET pw_hash = ? WHERE id = ?').run(hashPassword('0000'), +req.params.id);
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
  const rows = db.prepare(`SELECT s.id, s.created_at, s.ac_count, s.all_ac, s.total_time, s.results, u.student_id, u.name, u.id AS user_id
    FROM submissions s JOIN users u ON u.id = s.user_id ORDER BY s.id DESC LIMIT 200`).all();
  res.json(rows.map((r) => ({ ...r, results: JSON.parse(r.results) })));
});
app.get('/api/admin/leaderboard', requireAdmin, (req, res) => res.json({ cases: CASES.map((c) => ({ id: c.id, name: c.name })), rows: leaderboard(true) }));
app.get('/api/admin/cases', requireAdmin, (req, res) => res.json(CASES.map((c) => ({ ...c, input: caseInput(c) }))));

app.use('/api', (req, res) => err(res, 404, '없는 API 입니다'));

app.listen(PORT, () => {
  console.log(`Drone OJ 서버: http://localhost:${PORT}`);
  if (!process.env.ADMIN_PASSWORD) console.log(`⚠ ADMIN_PASSWORD 가 설정되지 않아 임시 관리자 비밀번호를 만들었습니다: ${ADMIN_PASSWORD}`);
  console.log(`2일차 공개 시각: ${getSettings().day2_open_at}`);
});
