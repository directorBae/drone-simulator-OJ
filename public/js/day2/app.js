import { $, esc, Console, createEditor, Runner, setPill, setupSplitters, bootScreen } from '../core/ui.js';
import { ReplayScene } from './replay.js';
import { FileTree } from './files.js';
import { STARTER } from './starter.js';
import { judgeCase, VERDICT_NAMES, BOUNDS, MAX_MISSION_TIME, MAX_OUTPUT_CHARS, MAX_WAYPOINTS } from './judge.js';
import { api, events, fmtTime, debounce } from './api.js';
import { renderLeaderboard } from './lb.js';

let CPU_LIMIT_SEC = 30; // 케이스당 계산 시간 제한 (서버 설정을 받아 씀)
const con = new Console($('console'));
let me = null, cfg = null, casesInfo = null, isAdmin = false;
let files = null, saveTimer = null, dirty = false;
let busy = false;
let editor, tree, runner, scene;

// ====================================================================== 시작
boot();
async function boot() {
  // 로그인하는 동안 Python 을 미리 내려받아 둠
  runner = new Runner({ sim: null, onStatus: (cls, text) => setPill($('pyStatus'), cls, text), onMessage: onRunner });
  cfg = await api('/api/config').catch(() => null);
  const r = await api('/api/auth/me').catch(() => ({}));
  isAdmin = !!r.admin;
  if (r.user) start(r.user); else showAuth();
}

// ====================================================================== 인증
function showAuth() {
  bootScreen.hold();
  $('auth').hidden = false;
  $('app').hidden = true;
  const tabs = document.querySelectorAll('.auth-tab');
  tabs.forEach((t) => (t.onclick = () => {
    tabs.forEach((x) => x.classList.toggle('active', x === t));
    $('signupExtra').hidden = $('signupExtra2').hidden = t.dataset.mode !== 'signup';
    $('authSubmit').textContent = t.dataset.mode === 'signup' ? '가입하고 시작' : '로그인';
    $('authForm').dataset.mode = t.dataset.mode;
    $('authMsg').textContent = '';
  }));
  $('authForm').onsubmit = async (e) => {
    e.preventDefault();
    const mode = $('authForm').dataset.mode || 'login';
    const studentId = $('aId').value.trim(), password = $('aPw').value;
    try {
      if (mode === 'signup') {
        if (password !== $('aPw2').value) throw new Error('비밀번호 확인이 일치하지 않습니다');
        const r = await api('/api/auth/signup', { method: 'POST', body: { studentId, name: $('aName').value.trim(), password } });
        start(r.user);
      } else {
        const r = await api('/api/auth/login', { method: 'POST', body: { studentId, password } });
        start(r.user);
      }
    } catch (ex) { $('authMsg').textContent = ex.message; }
  };
}

// ====================================================================== 앱
const docs = new Map();

async function start(user) {
  me = user;
  bootScreen.show();
  $('auth').hidden = true;
  $('app').hidden = false;
  $('userName').textContent = `${user.name} (${user.studentId})`;
  casesInfo = await api('/api/day2/cases');
  CPU_LIMIT_SEC = casesInfo.timeLimitSec || CPU_LIMIT_SEC;
  renderProblem();
  renderRules();

  // 프로젝트
  const proj = await api('/api/day2/project').catch(() => ({ files: null }));
  files = proj.files || structuredClone(STARTER);
  if (!proj.files) scheduleSave(0);
  else setSaveState('saved', proj.updatedAt);

  editor = createEditor($('editor'), { onRun: () => runSelected(), onSubmit: () => submit(), summaryEl: $('lintSummary'), onChange: onEdit });
  tree = new FileTree($('fileTree'), files, { onOpen: openFile, onChange: () => { rebuildDocs(); scheduleSave(); } });
  openFile('main.py');

  scene = new ReplayScene($('view3d'));
  scene.onTime = onTime;

  // 케이스 선택
  const sel = $('caseSelect');
  for (const c of casesInfo.cases) sel.add(new Option(`케이스 ${c.id} · ${c.name}${c.graded ? ' ★채점' : ''}`, String(c.id)));
  sel.onchange = () => previewCase(+sel.value);
  previewCase(+sel.value);

  wireUi();
  if (isAdmin) setupAdminSamples();
  loadSubmissions();
  loadLeaderboard();
  const lbSoon = debounce(loadLeaderboard), subsSoon = debounce(loadSubmissions);
  events({ leaderboard: lbSoon, judged: subsSoon, config: (c) => { cfg = c; renderDeadline(); lbSoon(); } },
    { onResume: () => { loadLeaderboard(); loadSubmissions(); api('/api/config').then((c) => { cfg = c; renderDeadline(); }).catch(() => {}); } });
  renderDeadline();
  con.sys(`2일차 군집 경로 챌린지 — ${user.name}님 환영합니다. 공개 케이스 4개를 ▶ 실행으로 확인하고, ✔ 제출로 공식 채점(공개 2 + 비공개 3)을 받으세요.`);
}

// ---------------------------------------------------------------------- 파일 · 편집기 · 저장
function openFile(p) {
  if (!(p in files)) return;
  showEditorTab('code');
  let doc = docs.get(p);
  if (!doc) { doc = CodeMirror.Doc(files[p], p.endsWith('.py') ? { name: 'python', version: 3 } : 'text/plain'); docs.set(p, doc); }
  editor.swapDoc(doc);
  $('curFile').textContent = p;
  editor.performLint && editor.performLint();
  editor.focus();
}
function rebuildDocs() {
  for (const p of [...docs.keys()]) if (!(p in files)) docs.delete(p);
  for (const [p, d] of docs) if (d.getValue() !== files[p]) d.setValue(files[p]);
}
function onEdit() {
  const p = tree.current;
  files[p] = editor.getValue();
  scheduleSave();
}
function scheduleSave(delay = 1200) {
  dirty = true;
  setSaveState('dirty');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, delay);
}
async function save() {
  if (!dirty) return;
  dirty = false;
  setSaveState('saving');
  try {
    const r = await api('/api/day2/project', { method: 'PUT', body: { files } });
    setSaveState('saved', r.updatedAt);
  } catch (e) {
    dirty = true;
    setSaveState('error', e.message);
    if (e.status === 401) { alert('로그인이 만료되었습니다. 다시 로그인하세요.'); location.reload(); }
    else { clearTimeout(saveTimer); saveTimer = setTimeout(save, 5000); }
  }
}
function setSaveState(state, info) {
  const el = $('saveState');
  el.className = 'save-state ' + state;
  el.textContent = { dirty: '● 수정됨', saving: '☁ 저장 중…', saved: `☁ 서버에 저장됨 ${info ? fmtTime(info) : ''}`, error: `⚠ 저장 실패: ${info || ''} (자동 재시도)` }[state];
}
window.addEventListener('beforeunload', (e) => { if (dirty) { save(); e.preventDefault(); e.returnValue = ''; } });
// 제출하면 버튼을 끈 채로 결과 화면으로 넘어감 → 브라우저 '뒤로 가기' 로 그 상태 그대로 복원되면(bfcache) 버튼을 다시 켬
window.addEventListener('pageshow', (e) => {
  if (!e.persisted || !me) return;
  busy = false;
  buttons();
  setPill($('pyStatus'), runner && runner.ready ? 'ready' : 'loading', runner && runner.ready ? '● ' + runner.version : 'Python 로딩 중…');
});

// ---------------------------------------------------------------------- 실행
function onRunner(m) {
  if (m.type === 'stdout') return; // 출력은 JSON 이라 콘솔에는 요약만 (아래 execute 에서)
  if (m.type === 'stderr') con.err(m.text);
  if (m.type === 'ready') buttons();
  if (m.type === 'pyerror') con.err('Python(Pyodide)을 불러오지 못했습니다: ' + m.text);
}

/** 한 입력으로 프로그램 실행 → {status: ok|CE|RE|TLE, stdout, ms, error} */
async function execute(input) {
  await runner.whenReady();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; runner.restart(null); }, CPU_LIMIT_SEC * 1000);
  // 출력은 채점 한도를 조금 넘는 데까지만 받음 → 넘으면 브라우저·서버 채점기 모두 '출력이 너무 큽니다'
  const m = await runner.run({ files, stdin: JSON.stringify(input), capture: true, captureLimit: MAX_OUTPUT_CHARS + 1 });
  clearTimeout(timer);
  if (timedOut) return { status: 'TLE', ms: CPU_LIMIT_SEC * 1000, error: `계산 시간 제한 ${CPU_LIMIT_SEC}초를 넘었습니다` };
  if (m.error) {
    if (m.error.file && m.error.line) { if (m.error.file !== tree.current && m.error.file in files) tree.open(m.error.file); editor.markError(m.error.line); }
    return { status: m.error.kind === 'CE' ? 'CE' : 'RE', ms: m.ms, error: m.error.text, stdout: m.stdout };
  }
  const out = m.stdout || '';
  return { status: 'ok', ms: m.ms, stdout: out.length > MAX_OUTPUT_CHARS ? out.slice(0, MAX_OUTPUT_CHARS + 1) : out };
}

function buttons() {
  const ready = runner && runner.ready && !busy;
  $('btnRun').disabled = !ready;
  $('btnSubmit').disabled = busy || (cfg && cfg.deadlinePassed); // 제출은 서버에서 실행하므로 Python 로딩과 무관
  $('btnStop').disabled = !busy;
}

async function runSelected() {
  if (busy || !runner.ready) return;
  const id = +$('caseSelect').value;
  const c = casesInfo.cases.find((x) => x.id === id);
  busy = true; buttons();
  await save();
  editor.clearError();
  con.div(`▶ 실행: 케이스 ${id} · ${c.name}`);
  setPill($('pyStatus'), 'running', '계산 중…');
  const r = await execute(c.input);
  busy = false; buttons();
  setPill($('pyStatus'), 'ready', '● ' + runner.version);
  if (r.status !== 'ok') {
    con.err(r.error);
    showResult(id, c.input, { verdict: r.status, message: firstLine(r.error) });
    return;
  }
  con.line(`계산 ${r.ms < 1000 ? Math.round(r.ms) + ' ms' : (r.ms / 1000).toFixed(2) + ' s'} · 출력 ${(r.stdout.length / 1024).toFixed(1)} KB`, 'c-sys');
  const res = judgeCase(c.input, r.stdout);
  con.line(`${res.verdict === 'AC' ? '✔' : '✖'} [${VERDICT_NAMES[res.verdict]}] ${res.message}`, res.verdict === 'AC' ? 'c-ok' : 'c-err');
  showResult(id, c.input, res);
}
function firstLine(s) { const l = String(s || '').trim().split('\n'); return l[l.length - 1]; }

function stop() {
  if (!busy) return;
  runner.restart(null);
  con.sys('■ 중지했습니다');
}

// ---------------------------------------------------------------------- 결과 · 리플레이
function previewCase(id) {
  const c = casesInfo.cases.find((x) => x.id === id);
  if (!c || !c.input) return;
  scene.setCase(c.input);
  $('resultBox').innerHTML = `<div class="dim">케이스 ${id} · ${esc(c.name)}${c.graded ? ' <b>★ 공식 채점에 포함</b>' : ''} — ${esc(c.desc)}<br>파란 칸 = 출발점 (드론 번호), 주황 점 = 목표점 (같은 번호의 드론이 가야 할 곳). ▶ 실행을 누르면 내 경로를 재생합니다.</div>`;
  $('timeline').hidden = true;
}
function showResult(id, input, res) {
  scene.setCase(input);
  if (res.paths) {
    scene.setPaths(res.paths, { collision: res.collision || null, highlight: res.drone ?? null });
    $('timeline').hidden = false;
    scene.play();
  } else $('timeline').hidden = true;
  const v = res.verdict;
  $('resultBox').innerHTML = `
    <div class="verdict-line"><span class="vchip v-${v}">${VERDICT_NAMES[v] || v}</span>
      ${res.missionTime != null && v === 'AC' ? `<b>미션 시간 ${res.missionTime.toFixed(2)} s</b>` : ''}
      <span class="dim">케이스 ${id}</span></div>
    <div class="result-msg">${esc(res.message || '')}</div>
    ${res.collision ? `<button class="mini" id="jumpCol">💥 충돌 순간으로 이동 (t=${res.collision.t.toFixed(2)}s)</button>` : ''}
    ${res.drone != null && res.t != null ? `<button class="mini" id="jumpRule">문제 지점으로 이동 (드론 ${res.drone}, t=${res.t.toFixed(2)}s)</button>` : ''}`;
  if ($('jumpCol')) $('jumpCol').onclick = () => { scene.pause(); scene.setTime(res.collision.t); };
  if ($('jumpRule')) $('jumpRule').onclick = () => { scene.pause(); scene.setTime(res.t); };
}
function onTime(t, dur) {
  $('tSlider').max = String(dur);
  $('tSlider').value = String(t);
  $('tLabel').textContent = `t = ${t.toFixed(2)} / ${dur.toFixed(2)} s`;
  $('btnPlay').textContent = scene.playing ? '❚❚' : '▶';
}

// ---------------------------------------------------------------------- 제출
// 코드를 서버로 보내면 서버가 채점 케이스 5개(공개 2 + 비공개 3)를 직접 실행·채점 → 결과 화면으로 이동
async function submit() {
  if (busy) return;
  if (cfg && cfg.deadlinePassed) { alert('제출이 마감되었습니다'); return; }
  busy = true; buttons();
  try {
    await save();
    const r = await api('/api/day2/submissions', { method: 'POST', body: { files } });
    dirty = false; // 결과 화면으로 넘어가도 저장 경고가 뜨지 않게 (방금 저장함)
    location.href = `result/?id=${r.id}`;
  } catch (e) {
    alert('제출 실패: ' + e.message);
    busy = false; buttons();
  }
}

// ---------------------------------------------------------------------- 관리자 테스트 코드 (관리자만)
function setupAdminSamples() {
  const btn = $('btnAdminSamples'), panel = $('samplePanel');
  btn.hidden = false;
  let list = null;
  const close = () => { panel.hidden = true; };
  btn.onclick = async (e) => {
    e.stopPropagation();
    if (!panel.hidden) return close();
    if (!list) list = await api('/api/admin/day2-samples').catch((ex) => { alert(ex.message); return null; });
    if (!list) return;
    panel.innerHTML = `<div class="sp-head">🔧 관리자 테스트 코드 <span class="dim">— 불러오면 지금 프로젝트를 바꿉니다 (이 계정의 코드)</span></div>` +
      list.map((s) => `<div class="sp-item">
        <div class="sp-title"><span class="sp-group g-${esc(s.group)}">${esc(s.group)}</span>${esc(s.title)}</div>
        <div class="sp-expect">예상: ${esc(s.expect)}</div>
        <div class="dim small">${esc(s.desc)}</div>
        <div class="sp-actions"><button class="mini" data-load="${esc(s.id)}">불러오기</button><button class="mini primary-mini" data-submit="${esc(s.id)}">불러와서 바로 제출</button></div>
      </div>`).join('');
    panel.hidden = false;
    panel.querySelectorAll('[data-load]').forEach((b) => (b.onclick = () => loadAdminSample(b.dataset.load, false).then(close)));
    panel.querySelectorAll('[data-submit]').forEach((b) => (b.onclick = () => loadAdminSample(b.dataset.submit, true).then(close)));
  };
  document.addEventListener('click', (e) => { if (!panel.hidden && !panel.contains(e.target) && e.target !== btn) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}
async function loadAdminSample(id, andSubmit) {
  const s = await api(`/api/admin/day2-samples/${encodeURIComponent(id)}`).catch((ex) => { alert(ex.message); return null; });
  if (!s) return;
  for (const k of Object.keys(files)) delete files[k];
  Object.assign(files, s.files);
  docs.clear(); tree.setFiles(files); openFile('main.py');
  switchView('code');
  con.div(`🔧 테스트 코드: ${s.title}`);
  con.sys(`예상 결과: ${s.expect} — ▶ 실행으로 공개 케이스를 보거나 ✔ 제출로 공식 채점해 보세요.`);
  dirty = true;
  await save();
  if (andSubmit) submit();
}

// ---------------------------------------------------------------------- 내 제출 · 리더보드
async function loadSubmissions() {
  const list = await api('/api/day2/submissions/mine').catch(() => []);
  const G = casesInfo.graded;
  $('subList').innerHTML = list.length ? `<table class="tbl wide"><tr><th>#</th><th>시각</th>${G.map((c) => `<th>${esc(c.name)}${c.hidden ? ' 🔒' : ''}</th>`).join('')}<th>통과 · 시간 합</th><th></th></tr>` +
    list.map((s) => `<tr><td><a href="result/?id=${s.id}">${s.id}</a></td><td>${fmtTime(s.createdAt)}</td>${s.status === 'error' ? `<td colspan="${G.length + 1}" class="bad-text">제출 오류: ${esc(s.error || '')}</td>`
      : `${G.map((c) => { const r = s.results.find((x) => x.caseId === c.id) || {}; const st = r.verdict || r.state || 'WAIT'; return `<td title="${esc(r.message || '')}"><span class="vchip v-${st}">${VERDICT_NAMES[st] || st}</span>${r.verdict === 'AC' ? `<br><small>${r.missionTime.toFixed(2)}s</small>` : ''}</td>`; }).join('')}
      <td>${s.status === 'judging' ? '<span class="dim">⏳ 채점 중</span>' : `<b>${s.passCount}/${s.total}</b>${s.passCount ? ` · ${s.totalTime.toFixed(2)} s` : ''}`}</td>`}
      <td><button class="mini" data-load="${s.id}">코드 불러오기</button></td></tr>`).join('') + '</table>'
    : '<p class="dim">아직 제출이 없습니다.</p>';
  $('subList').querySelectorAll('[data-load]').forEach((b) => (b.onclick = async () => {
    if (!confirm(`제출 #${b.dataset.load} 의 코드로 지금 프로젝트를 바꿀까요? (지금 코드는 사라집니다)`)) return;
    const r = await api(`/api/day2/submissions/${b.dataset.load}/files`);
    for (const k of Object.keys(files)) delete files[k];
    Object.assign(files, r.files);
    docs.clear(); tree.setFiles(files); openFile('main.py'); scheduleSave(0);
    switchView('code');
  }));
}
async function loadLeaderboard() {
  const lb = await api('/api/leaderboard').catch(() => null);
  const box = $('lbBox');
  if (!lb) return;
  if (!lb.open && !lb.rows) {
    box.innerHTML = `<div class="lb-closed">🔒 스코어보드는 아직 공개되지 않았습니다${lb.openAt ? `<br><span class="dim">공개 예정: ${new Date(lb.openAt).toLocaleString('ko-KR')}</span>` : ''}</div>`;
    return;
  }
  box.innerHTML = renderLeaderboard(lb, { meName: me.name });
}
// ---------------------------------------------------------------------- 코드 옆 '규칙 · JSON 형식' 탭
function showEditorTab(t) {
  document.querySelectorAll('.etab').forEach((b) => b.classList.toggle('active', b.dataset.etab === t));
  $('editor').hidden = t !== 'code';
  $('rulesPane').hidden = t !== 'rules';
  if (t === 'code' && editor) editor.refresh();
}
function renderRules() {
  const R = casesInfo.rules;
  const ex = casesInfo.cases[0] && casesInfo.cases[0].input;
  const s0 = ex ? ex.starts[0] : [0, 0, 0], g0 = ex ? ex.targets[0] : [1, 2, 8];
  $('rulesPane').innerHTML = `
    <div class="rp-lead">프로그램이 할 일은 <b>입력 JSON 을 읽어 드론별 웨이포인트 JSON 을 출력</b>하는 것뿐입니다. 채점기는 출력된 JSON 만 검사합니다.</div>
    <h4>제약 조건</h4>
    <table class="tbl rp-tbl">
      <tr><td>최고 속력</td><td><b>v_max = ${R.v_max} m/s</b> — 웨이포인트 사이 직선 거리 ÷ 시간 차가 이보다 크면 안 됨</td></tr>
      <tr><td>충돌</td><td>두 드론의 max(|Δx|, |Δy|, |Δz|) &lt; <b>${R.min_sep} m</b> 인 순간이 있으면 충돌 (정확히 ${R.min_sep} 은 허용)</td></tr>
      <tr><td>미션</td><td>착륙장(<b>starts</b>)에서 이륙 → 모든 드론이 <b>동시에 ${R.hold}초 이상</b> 자기 목표(<b>targets[i]</b>, 오차 ${R.tol} m)에 → 자기 착륙 지점으로 <b>복귀</b></td></tr>
      <tr><td>시간</td><td>t 는 0 에서 시작해 <b>계속 커져야</b> 함 · 미션 시간 = 마지막 드론이 착륙한 시각 = 가장 늦은 마지막 t (작을수록 좋음, 최대 ${MAX_MISSION_TIME} s)</td></tr>
      <tr><td>영역</td><td>x ${BOUNDS.x.join('~')} · y ${BOUNDS.y.join('~')} · z 0~${BOUNDS.z[1]} (z 는 위가 +)</td></tr>
      <tr><td>크기</td><td>드론당 웨이포인트 ≤ ${MAX_WAYPOINTS.toLocaleString()}개 · 계산 시간 케이스당 ${CPU_LIMIT_SEC}초</td></tr>
    </table>
    <h4>입력 (stdin) — <code>problem</code></h4>
    <pre class="rp-json">{
  "v_max": ${R.v_max},
  "min_sep": ${R.min_sep},
  "tol": ${R.tol},
  "hold": ${R.hold},                      ← 대형 유지 시간 (초)
  "starts":  [[${s0.join(', ')}], …],     ← i번 드론의 착륙 지점 (출발점 = 복귀점, 드론 20대)
  "targets": [[${g0.join(', ')}], …]      ← i번 드론이 대형에서 맡을 자리
}</pre>
    <h4>출력 (stdout) — <code>plan()</code> 이 돌려준 paths</h4>
    <pre class="rp-json">{"paths": [
  [[0, ${s0.join(', ')}], [3.0, ${s0[0]}, ${s0[1]}, 3], [11.9, ${g0.join(', ')}],      ← 드론 0: 이륙 → 목표
   [14.0, ${g0.join(', ')}],                                      ←          모두 모일 때까지 + 대형 유지 (같은 위치 반복)
   [22.9, ${s0[0]}, ${s0[1]}, 3], [25.9, ${s0.join(', ')}]],                  ←          복귀 · 착륙
  …                                                              ← 드론 1 ~ 19
]}
 [t, x, y, z]: t초에 (x, y, z) 에 있음. 사이는 직선 · 일정한 속도로 이동
 [3.0 …] → [3.5 …] 처럼 같은 위치를 반복하면 그동안 제자리에서 기다림</pre>
    <p class="dim small">stdout 에는 이 JSON 한 줄만 나가야 합니다. 디버그 출력은 <code>print(..., file=sys.stderr)</code>. 자세한 설명은 위쪽 🧩 문제 탭.</p>`;
}

// ---------------------------------------------------------------------- 문제 설명
function renderProblem() {
  const R = casesInfo.rules, G = casesInfo.graded;
  $('problemBody').innerHTML = `
  <h2>드론 20대, 충돌 없이 가장 빠르게</h2>
  <p><b>착륙장(5 × 4, 2 m 간격)의 드론 20대로 목표 모양을 만들고 다시 착륙장으로 복귀</b>하는 웨이포인트(시각 + 위치)를 <b>미리 계산</b>하는 프로그램을 작성하세요. i번 드론은 자기 착륙 지점에서 이륙해 자기 목표점(같은 번호)으로 가고, 20대가 <b>동시에 ${R.hold}초 이상</b> 모양을 유지한 뒤 자기 착륙 지점으로 돌아옵니다. 그동안 어떤 두 드론도 부딪히면 안 됩니다.</p>
  <h3>월드</h3>
  <ul><li>드론 20대 · 크기 0.3 × 0.3 × 0.3 m 정육면체 · 위치 = 정육면체 중심</li>
  <li>좌표계: 단위 m · <b>z 는 위가 +</b> (1일차 NED 와 반대 — NED z = −z)</li>
  <li>착륙장 A: 5 × 4 배치, 2 m 간격, z = 0 · i번 드론 착륙 지점 = (2·(i mod 5), 2·⌊i/5⌋, 0) — 모든 케이스 공통</li>
  <li>목표 모양은 케이스마다 다릅니다 (입력의 targets)</li></ul>
  <h3>비행 규칙</h3>
  <table class="tbl"><tr><th>규칙</th><th>내용</th></tr>
  <tr><td>할당</td><td><b>고정</b> — i번 드론은 targets[i] 로</td></tr>
  <tr><td>속도</td><td>모든 구간에서 속력 ≤ v_max = <b>${R.v_max} m/s</b> (웨이포인트 사이 직선 거리 ÷ 시간). 항상 최고 속도로 갈지, 구간마다 속도를 바꾸거나 기다릴지는 자유</td></tr>
  <tr><td>대형 완성</td><td>20대 모두 자기 목표점에서 <b>${R.tol} m</b> 이내에 <b>동시에 ${R.hold}초 이상</b></td></tr>
  <tr><td>복귀</td><td>마지막 웨이포인트 = 자기 착륙 지점 (오차 ${R.tol} m). 착륙한 뒤에는 그 자리에 머무름 (계속 충돌 검사 대상)</td></tr>
  <tr><td>충돌</td><td>max(|Δx|, |Δy|, |Δz|) &lt; <b>${R.min_sep}</b> 이 되는 순간이 있으면 충돌 → 그 케이스는 실패. 웨이포인트 사이를 직선 보간해 <b>연속 시간 전체를 해석적으로</b> 검사합니다.</td></tr>
  <tr><td>비행 영역</td><td>z ≥ 0 · x ${BOUNDS.x.join(' ~ ')} · y ${BOUNDS.y.join(' ~ ')} · z ≤ ${BOUNDS.z[1]} · 미션 시간 ≤ ${MAX_MISSION_TIME} s</td></tr>
  <tr><td>기록</td><td>마지막 드론이 착륙한 시각 = <b>미션 시간</b></td></tr>
  <tr><td>계산 시간</td><td>케이스당 <b>${CPU_LIMIT_SEC}초</b> 안에 경로를 출력해야 함 (넘으면 시간 초과)</td></tr></table>
  <h3>입력과 출력</h3>
  <p><b>입력</b> (표준입력, JSON): <code>{"v_max", "starts": [[x,y,z]×20], "targets": [[x,y,z]×20], "min_sep", "tol", "hold"}</code></p>
  <p><b>출력</b> (표준출력, JSON): <code>{"paths": [ [[t,x,y,z], …] × 20 ]}</code> — i번째 경로가 i번 드론.
  t 는 0 에서 시작해 <b>엄격히 증가</b>, 첫 웨이포인트 = 자기 착륙 지점 (t=0), 마지막 웨이포인트 = 자기 착륙 지점 (복귀).
  제자리에서 기다리려면 같은 위치를 더 늦은 t 로 한 번 더 적으면 됩니다.
  드론당 웨이포인트 ≤ ${MAX_WAYPOINTS.toLocaleString()}개, 케이스당 출력 ≤ ${(MAX_OUTPUT_CHARS / 1e6).toFixed(0)}M자.</p>
  <pre>{"paths": [
  [[0.0, 0, 0, 0], [5.0, 0, 0, 5], [5.8, 0, 0, 5], [12.0, 3, 4, 8]],   # 드론 0: 상승 → 0.8초 대기 → 목표
  …                                                                 # 20개
]}</pre>
  <p class="dim">stdout 에는 JSON 만 출력하세요. 디버그 출력은 <code>print(..., file=sys.stderr)</code>. (마지막 줄이 JSON 이면 앞의 출력은 무시합니다)</p>
  <h3>테스트 케이스</h3>
  <p>공개 케이스 4개는 입력을 받아 <b>▶ 실행</b>으로 브라우저에서 바로 확인·3D 재생할 수 있습니다. <b>✔ 제출</b>하면 서버가 내 코드를 직접 실행해 <b>공개 2개(★) + 비공개 3개</b>로 공식 채점합니다. 비공개 케이스는 충돌을 일으키기 쉬운 상황(예: 서로 자리 바꾸기, 좁은 곳에 모이기)이며 입력은 공개되지 않습니다.</p>
  <table class="tbl"><tr><th>#</th><th>이름</th><th>설명</th><th>공식 채점</th><th></th></tr>
  ${casesInfo.cases.map((c) => `<tr><td>${c.id}</td><td>${esc(c.name)}</td><td>${esc(c.desc)}</td><td>${c.graded ? '★ 포함' : '<span class="dim">연습용</span>'}</td><td><button class="mini" data-preview="${c.id}">3D 로 보기</button> <button class="mini" data-dl="${c.id}">입력 JSON 받기</button></td></tr>`).join('')}
  ${G.filter((c) => c.hidden).map((c) => `<tr><td>🔒</td><td>${esc(c.name)}</td><td class="dim">채점할 때 서버에서만 실행</td><td>★ 포함</td><td></td></tr>`).join('')}</table>
  <h3>채점 결과</h3>
  <table class="tbl"><tr><th>결과</th><th>의미</th></tr>
  <tr><td><span class="vchip v-AC">성공</span></td><td>충돌 없이 대형 완성 후 모두 복귀 · 미션 시간 기록</td></tr>
  <tr><td><span class="vchip v-COL">충돌</span></td><td>드론 i 와 j 가 시각 t 에 충돌 → 그 케이스 실패</td></tr>
  <tr><td><span class="vchip v-CE">컴파일 에러</span></td><td>코드에 문법 오류 → 5개 케이스 모두 실패</td></tr>
  <tr><td><span class="vchip v-TLE">시간 초과</span></td><td>경로 계산이 케이스당 ${CPU_LIMIT_SEC}초를 넘음</td></tr>
  <tr><td><span class="vchip v-RE">런타임 에러</span></td><td>실행 중 예외 발생 (비공개 케이스는 에러 종류와 줄 번호만 표시)</td></tr>
  <tr><td><span class="vchip v-RV">규칙 위반</span></td><td>속도 초과 · 대형 미완성 · 미복귀 · 영역 이탈 · 형식 오류</td></tr></table>
  <h3>순위</h3>
  <ul><li>① <b>통과한 케이스 수</b>가 많은 순 — 5개 통과는 4개 통과보다 항상 위</li><li>② 통과 수가 같으면 <b>통과한 케이스의 미션 시간 합</b>이 작은 순</li><li>③ 그래도 같으면 먼저 제출한 순 · 내 제출 중 가장 좋은 기록으로 계산</li><li>2일차 공개 시각 이후에 낸 제출만 스코어보드에 들어갑니다</li>
  <li id="deadlineLi"></li></ul>
  <h3>프로그램 구조</h3>
  <p>시작 코드의 <code>main.py</code> 에서 <b><code>plan(problem)</code> 함수만 채우면</b> 됩니다 (<code>main()</code> 이 입력을 읽고 결과 JSON 을 출력합니다). 필요하면 파일·폴더를 더 만들어 <code>from mymodule import f</code> 처럼 import 할 수 있습니다. 표준 라이브러리만 쓸 수 있고, 코드는 서버에 자동 저장됩니다.</p>`;
  $('problemBody').querySelectorAll('[data-preview]').forEach((b) => (b.onclick = () => { $('caseSelect').value = b.dataset.preview; previewCase(+b.dataset.preview); switchView('code'); }));
  $('problemBody').querySelectorAll('[data-dl]').forEach((b) => (b.onclick = () => {
    const c = casesInfo.cases.find((x) => x.id === +b.dataset.dl);
    download(`case${c.id}.json`, JSON.stringify(c.input, null, 1));
  }));
}
function renderDeadline() {
  const li = $('deadlineLi');
  if (li) li.textContent = cfg && cfg.submitDeadline ? `제출 마감: ${new Date(cfg.submitDeadline).toLocaleString('ko-KR')}${cfg.deadlinePassed ? ' (마감됨)' : ''}` : '제출 횟수 제한 없음 (10초에 한 번)';
  buttons();
}
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------------------------------------------------------------------- UI 연결
function switchView(v) {
  document.querySelectorAll('.vtab').forEach((t) => t.classList.toggle('active', t.dataset.view === v));
  for (const id of ['problem', 'code', 'board', 'subs']) $('view-' + id).hidden = id !== v;
  if (v === 'code') { editor.refresh(); scene.resize(); }
  if (v === 'board') loadLeaderboard();
  if (v === 'subs') loadSubmissions();
}
function wireUi() {
  document.querySelectorAll('.vtab').forEach((t) => (t.onclick = () => switchView(t.dataset.view)));
  $('btnRun').onclick = runSelected;
  document.querySelectorAll('.etab').forEach((b) => (b.onclick = () => showEditorTab(b.dataset.etab)));
  $('btnSubmit').onclick = submit;
  $('btnStop').onclick = stop;
  $('btnNewFile').onclick = () => tree.newFile();
  $('btnNewFolder').onclick = () => tree.newFolder();
  $('btnRename').onclick = () => tree.rename();
  $('btnDelete').onclick = () => tree.remove();
  $('btnUpload').onclick = () => $('upFiles').click();
  $('btnUploadDir').onclick = () => $('upDir').click();
  const onUp = async (e) => {
    const r = await tree.upload(e.target.files);
    e.target.value = '';
    con.sys(`업로드: ${r.added.length}개 추가${r.skipped.length ? ` · 건너뜀 ${r.skipped.length}개 (${r.skipped.slice(0, 3).join(', ')}…)` : ''}`);
  };
  $('upFiles').onchange = onUp;
  $('upDir').onchange = onUp;
  $('btnDownloadFile').onclick = () => download(tree.current.split('/').pop(), files[tree.current]);
  $('btnStarter').onclick = () => {
    if (!confirm('시작 코드로 되돌릴까요? 지금 프로젝트의 모든 파일이 사라집니다.')) return;
    for (const k of Object.keys(files)) delete files[k];
    Object.assign(files, structuredClone(STARTER));
    docs.clear(); tree.setFiles(files); openFile('main.py'); scheduleSave(0);
  };
  $('btnClearConsole').onclick = () => con.clear();
  $('btnPlay').onclick = () => (scene.playing ? scene.pause() : scene.play());
  $('tSlider').oninput = (e) => { scene.pause(); scene.setTime(+e.target.value); };
  $('speed').onchange = (e) => { scene.speed = +e.target.value; };
  $('chkPaths').onchange = (e) => scene.togglePaths(e.target.checked);
  $('chkLabels').onchange = (e) => scene.toggleLabels(e.target.checked);
  $('btnLogout').onclick = async () => { await save(); await api('/api/auth/logout', { method: 'POST' }); location.reload(); };
  $('btnPw').onclick = async () => {
    const oldPassword = prompt('현재 비밀번호');
    if (oldPassword == null) return;
    const newPassword = prompt('새 비밀번호 (4자 이상)');
    if (!newPassword) return;
    try { await api('/api/auth/password', { method: 'POST', body: { oldPassword, newPassword } }); alert('비밀번호를 바꿨습니다'); } catch (e) { alert(e.message); }
  };
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); }
  });
  setupSplitters({ main: $('splitMain'), layout: $('layout'), left: $('left'), leftSplit: $('splitLeft'), leftTop: $('leftTop') });
  switchView('code');
}
