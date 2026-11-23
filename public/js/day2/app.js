import { $, esc, Console, createEditor, Runner, setPill, setupSplitters } from '../core/ui.js';
import { ReplayScene } from './replay.js';
import { FileTree } from './files.js';
import { STARTER } from './starter.js';
import { judgeCase, VERDICT_NAMES, BOUNDS, MAX_MISSION_TIME } from './judge.js';
import { api, events, fmtTime } from './api.js';
import { renderLeaderboard } from './lb.js';

const CPU_LIMIT_SEC = 30; // 케이스당 계산 시간 제한
const con = new Console($('console'));
let me = null, cfg = null, casesInfo = null;
let files = null, saveTimer = null, dirty = false;
let busy = false;
const localResults = {}; // caseId → {input, result}

// ====================================================================== 시작
boot();
async function boot() {
  cfg = await api('/api/config').catch(() => null);
  const r = await api('/api/auth/me').catch(() => ({}));
  if (r.user) start(r.user); else showAuth();
}

// ====================================================================== 인증
function showAuth() {
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
let editor, tree, runner, scene;
const docs = new Map();

async function start(user) {
  me = user;
  $('auth').hidden = true;
  $('app').hidden = false;
  $('userName').textContent = `${user.name} (${user.studentId})`;
  casesInfo = await api('/api/day2/cases');
  renderProblem();

  // 프로젝트
  const proj = await api('/api/day2/project').catch(() => ({ files: null }));
  files = proj.files || structuredClone(STARTER);
  if (!proj.files) scheduleSave(0);
  else setSaveState('saved', proj.updatedAt);

  editor = createEditor($('editor'), { onRun: () => runSelected(), onSubmit: () => submit(), summaryEl: $('lintSummary'), onChange: onEdit });
  tree = new FileTree($('fileTree'), files, { onOpen: openFile, onChange: () => { rebuildDocs(); scheduleSave(); } });
  openFile('main.py');

  runner = new Runner({ sim: null, onStatus: (cls, text) => setPill($('pyStatus'), cls, text), onMessage: onRunner });
  scene = new ReplayScene($('view3d'));
  scene.onTime = onTime;

  // 케이스 선택
  const sel = $('caseSelect');
  for (const c of casesInfo.cases.filter((x) => !x.hidden)) sel.add(new Option(`케이스 ${c.id} · ${c.name}`, String(c.id)));
  sel.onchange = () => previewCase(+sel.value);
  previewCase(+sel.value);

  wireUi();
  loadSubmissions();
  loadLeaderboard();
  events({ leaderboard: () => loadLeaderboard(), config: (c) => { cfg = c; renderDeadline(); loadLeaderboard(); } });
  renderDeadline();
  con.sys(`2일차 군집 경로 챌린지 — ${user.name}님 환영합니다. 케이스를 골라 ▶ 실행으로 확인하고, ✔ 제출로 5개 케이스 공식 채점을 받으세요.`);
}

// ---------------------------------------------------------------------- 파일 · 편집기 · 저장
function openFile(p) {
  if (!(p in files)) return;
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
  const m = await runner.run({ files, stdin: JSON.stringify(input), capture: true });
  clearTimeout(timer);
  if (timedOut) return { status: 'TLE', ms: CPU_LIMIT_SEC * 1000, error: `계산 시간 제한 ${CPU_LIMIT_SEC}초를 넘었습니다` };
  if (m.error) {
    if (m.error.file && m.error.line) { if (m.error.file !== tree.current && m.error.file in files) tree.open(m.error.file); editor.markError(m.error.line); }
    return { status: m.error.kind === 'CE' ? 'CE' : 'RE', ms: m.ms, error: m.error.text, stdout: m.stdout };
  }
  return { status: 'ok', ms: m.ms, stdout: m.stdout || '' };
}

function buttons() {
  const ready = runner && runner.ready && !busy;
  $('btnRun').disabled = !ready;
  $('btnSubmit').disabled = !ready || (cfg && cfg.deadlinePassed);
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
  localResults[id] = { input: c.input, result: res };
  showResult(id, c.input, res);
}
function firstLine(s) { const l = String(s || '').trim().split('\n'); return l[l.length - 1]; }

function stop() {
  if (!busy) return;
  submitAbort = true;
  runner.restart(null);
  con.sys('■ 중지했습니다');
}

// ---------------------------------------------------------------------- 결과 · 리플레이
function previewCase(id) {
  const c = casesInfo.cases.find((x) => x.id === id);
  if (!c || !c.input) return;
  scene.setCase(c.input);
  $('resultBox').innerHTML = `<div class="dim">케이스 ${id} · ${esc(c.name)} — ${esc(c.desc)}<br>주황 점 = 목표점 (번호), 바닥 칸 = 착륙장 A (드론 번호). ▶ 실행을 누르면 내 경로를 다시 재생합니다.</div>`;
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
let submitAbort = false;
async function submit() {
  if (busy || !runner.ready) return;
  if (cfg && cfg.deadlinePassed) { alert('제출이 마감되었습니다'); return; }
  if (!confirm('5개 테스트 케이스(비공개 포함)로 공식 채점합니다. 제출할까요?')) return;
  busy = true; submitAbort = false; buttons();
  await save();
  editor.clearError();
  let st;
  try { st = await api('/api/day2/submit/start', { method: 'POST' }); }
  catch (e) { alert(e.message); busy = false; buttons(); return; }
  con.div('✔ 제출 — 5개 케이스 실행 중…');
  const rows = st.cases.map((c) => ({ caseId: c.id, name: c.name, hidden: c.hidden, state: 'WAIT' }));
  const render = (official) => {
    $('resultBox').innerHTML = `<div class="sub-title">${official ? '공식 채점 결과' : '실행 중…'}</div>` + rows.map((r) => `
      <div class="case-row" data-case="${r.caseId}">
        <span class="cid">#${r.caseId}</span><span class="cname">${esc(r.name)}${r.hidden ? ' 🔒' : ''}</span>
        <span class="vchip v-${r.state}">${VERDICT_NAMES[r.state] || (r.state === 'WAIT' ? '대기' : '실행 중')}</span>
        <span class="ctime">${r.missionTime != null ? r.missionTime.toFixed(2) + ' s' : ''}</span>
        <div class="cmsg dim">${esc(r.message || '')}</div></div>`).join('') +
      (official ? `<div class="sub-total">${official.allAc ? `🎉 5개 모두 성공! 미션 시간 합 <b>${official.totalTime.toFixed(2)} s</b>` : `성공 ${official.acCount}/5 — 5개를 모두 성공해야 순위에 오릅니다`}</div>` : '');
    $('resultBox').querySelectorAll('.case-row').forEach((el) => (el.onclick = () => {
      const lr = localResults['s' + el.dataset.case];
      if (lr) showReplayOnly(lr);
    }));
  };
  const payload = [];
  setPill($('pyStatus'), 'running', '채점 중…');
  for (let k = 0; k < st.cases.length; k++) {
    if (submitAbort) break;
    const c = st.cases[k];
    rows[k].state = 'RUN'; render();
    let r;
    if (k > 0 && payload[0].status === 'CE') r = { status: 'CE', ms: 0, error: payload[0].error };
    else r = await execute(c.input);
    if (submitAbort) break;
    payload.push({ caseId: c.id, status: r.status, stdout: r.stdout || '', ms: Math.round(r.ms), error: r.error });
    const local = r.status === 'ok' ? judgeCase(c.input, r.stdout) : { verdict: r.status, message: firstLine(r.error) };
    localResults['s' + c.id] = { input: c.input, result: local, id: c.id };
    Object.assign(rows[k], { state: local.verdict, missionTime: local.verdict === 'AC' ? local.missionTime : null, message: local.message });
    render();
  }
  if (submitAbort) { busy = false; buttons(); con.sys('제출을 취소했습니다'); return; }
  try {
    const fin = await api('/api/day2/submit/finish', { method: 'POST', body: { token: st.token, files, results: payload } });
    fin.results.forEach((r, k) => Object.assign(rows[k], { state: r.verdict, missionTime: r.missionTime, message: r.message }));
    render(fin);
    con.line(fin.allAc ? `🎉 제출 #${fin.id}: 5개 모두 성공 — 미션 시간 합 ${fin.totalTime.toFixed(2)}s` : `제출 #${fin.id}: 성공 ${fin.acCount}/5`, fin.allAc ? 'c-ok' : 'c-err');
    const firstFail = fin.results.find((r) => r.verdict !== 'AC');
    const lr = localResults['s' + (firstFail ? firstFail.caseId : fin.results[0].caseId)];
    if (lr && lr.result.paths) showReplayOnly(lr);
    loadSubmissions();
  } catch (e) { alert('제출 실패: ' + e.message); }
  busy = false; buttons();
  setPill($('pyStatus'), 'ready', '● ' + runner.version);
}
function showReplayOnly(lr) {
  scene.setCase(lr.input);
  if (lr.result.paths) {
    scene.setPaths(lr.result.paths, { collision: lr.result.collision || null, highlight: lr.result.drone ?? null });
    $('timeline').hidden = false;
    scene.play();
  }
}

// ---------------------------------------------------------------------- 내 제출 · 리더보드
async function loadSubmissions() {
  const list = await api('/api/day2/submissions/mine').catch(() => []);
  $('subList').innerHTML = list.length ? `<table class="tbl wide"><tr><th>#</th><th>시각</th>${[1, 2, 3, 4, 5].map((i) => `<th>케이스 ${i}</th>`).join('')}<th>합계</th><th></th></tr>` +
    list.map((s) => `<tr><td>${s.id}</td><td>${fmtTime(s.createdAt)}</td>${s.results.map((r) => `<td title="${esc(r.message || '')}"><span class="vchip v-${r.verdict}">${VERDICT_NAMES[r.verdict]}</span>${r.missionTime != null && r.verdict === 'AC' ? `<br><small>${r.missionTime.toFixed(2)}s</small>` : ''}</td>`).join('')}
      <td>${s.allAc ? `<b>${s.totalTime.toFixed(2)} s</b>` : `${s.acCount}/5`}</td><td><button class="mini" data-load="${s.id}">코드 불러오기</button></td></tr>`).join('') + '</table>'
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
// ---------------------------------------------------------------------- 문제 설명
function renderProblem() {
  const R = casesInfo.rules;
  $('problemBody').innerHTML = `
  <h2>드론 20대, 충돌 없이 가장 빠르게</h2>
  <p>착륙장 A 의 드론 20대로 <b>목표 모양을 만들고</b>, 다시 <b>각자의 착륙 지점으로 돌아오게</b> 하는 경로를 계산하는 프로그램을 작성하세요.</p>
  <h3>월드</h3>
  <ul><li>드론 20대 · 크기 0.3 × 0.3 × 0.3 m 정육면체 · 위치 = 정육면체 중심</li>
  <li>좌표계: 단위 m · <b>z 는 위가 +</b> (1일차 NED 와 반대 — NED z = −z)</li>
  <li>착륙장 A: 5 × 4 배치, 2 m 간격, z = 0 · i번 드론 시작점 = (2·(i mod 5), 2·⌊i/5⌋, 0)</li></ul>
  <h3>비행 규칙</h3>
  <table class="tbl"><tr><th>규칙</th><th>내용</th></tr>
  <tr><td>속도 제한</td><td>모든 구간에서 속력 ≤ v_max = <b>${R.v_max} m/s</b> (웨이포인트 사이 직선 거리 ÷ 시간)</td></tr>
  <tr><td>대형 완성</td><td>20개 목표점이 모두 오차 <b>${R.tol} m</b> 이내로 <b>동시에 ${R.hold} s</b> 이상 채워져야 함</td></tr>
  <tr><td>목표점 할당</td><td><b>자유</b> — 어느 드론이 어느 목표점에 가도 됨</td></tr>
  <tr><td>복귀 위치</td><td>각자 <b>출발한 착륙 지점</b> (마지막 웨이포인트 = 시작점, z = 0)</td></tr>
  <tr><td>비행 영역</td><td>z ≥ 0 · x ${BOUNDS.x.join(' ~ ')} · y ${BOUNDS.y.join(' ~ ')} · z ≤ ${BOUNDS.z[1]} · 미션 시간 ≤ ${MAX_MISSION_TIME} s</td></tr>
  <tr><td>충돌</td><td>max(|Δx|, |Δy|, |Δz|) &lt; <b>${R.min_sep}</b> 이 되는 순간이 있으면 충돌 (정확히 0.3 은 허용). 웨이포인트 사이를 직선 보간해 <b>연속 시간 전체를 해석적으로</b> 검사합니다. 착륙장에 내려앉은 드론도 검사 대상입니다.</td></tr>
  <tr><td>기록</td><td>마지막 드론이 착륙한 시각 = 미션 시간</td></tr></table>
  <h3>입력과 출력</h3>
  <p><b>입력</b> (표준입력, JSON): <code>{"v_max", "starts": [[x,y,z]×20], "targets": [[x,y,z]×20], "min_sep", "tol", "hold"}</code></p>
  <p><b>출력</b> (표준출력, JSON): <code>{"paths": [ [[t,x,y,z], …] × 20 ]}</code> — i번째 경로가 i번 드론.
  t 는 0 에서 시작해 <b>엄격히 증가</b>, 첫 웨이포인트 = 자기 착륙 지점 (t=0), 마지막 웨이포인트 = 자기 착륙 지점 (z=0).
  마지막 웨이포인트 이후에는 그 자리에 머무릅니다.</p>
  <pre>{"paths": [
  [[0.0, 0, 0, 0], [2.0, 0, 0, 5], [6.5, 4, 3, 10], …, [30.0, 0, 0, 0]],   # 드론 0
  …                                                                       # 20개
]}</pre>
  <p class="dim">stdout 에는 JSON 만 출력하세요. 디버그 출력은 <code>print(..., file=sys.stderr)</code>. (마지막 줄이 JSON 이면 앞의 출력은 무시합니다)</p>
  <h3>채점 결과</h3>
  <table class="tbl"><tr><th>결과</th><th>의미</th></tr>
  <tr><td><span class="vchip v-AC">성공</span></td><td>충돌 없이 대형 완성 후 복귀 · 미션 시간 기록</td></tr>
  <tr><td><span class="vchip v-COL">충돌 에러</span></td><td>드론 i 와 j 가 시각 t 에 충돌 (번호 · 시각 · 위치 표시, 3D 리플레이에 빨간 상자)</td></tr>
  <tr><td><span class="vchip v-CE">컴파일 에러</span></td><td>코드에 문법 오류 (파일 · 줄 번호 표시)</td></tr>
  <tr><td><span class="vchip v-RE">런타임 에러</span></td><td>실행 중 예외 발생</td></tr>
  <tr><td><span class="vchip v-RV">규칙 위반</span></td><td>속도 초과 · 대형 미완성 · 미복귀 · 영역 이탈 · 형식 오류</td></tr>
  <tr><td><span class="vchip v-TLE">시간 초과</span></td><td>경로 계산이 케이스당 ${CPU_LIMIT_SEC}초를 넘음</td></tr></table>
  <h3>테스트 케이스</h3>
  <table class="tbl"><tr><th>#</th><th>이름</th><th>설명</th><th></th></tr>
  ${casesInfo.cases.map((c) => `<tr><td>${c.id}</td><td>${esc(c.name)}</td><td>${esc(c.desc)}</td><td>${c.input ? `<button class="mini" data-preview="${c.id}">3D 로 보기</button> <button class="mini" data-dl="${c.id}">입력 JSON 받기</button>` : '🔒 채점 시에만'}</td></tr>`).join('')}</table>
  <h3>순위</h3>
  <ul><li>5개 케이스 <b>모두 성공</b>해야 순위에 오릅니다</li><li>점수 = 5개 케이스 <b>미션 시간의 합</b> (작을수록 좋음) · 내 제출 중 가장 좋은 기록</li><li>동점이면 먼저 제출한 순</li>
  <li id="deadlineLi"></li></ul>
  <h3>프로그램 구조</h3>
  <p>여러 파일과 폴더로 나눠 작성할 수 있습니다 (왼쪽 파일 탐색기 · 파일/폴더 업로드). 실행은 항상 <code>main.py</code> 에서 시작하고, <code>from planner.solver import Solver</code> 처럼 import 합니다. 코드는 서버에 자동 저장됩니다.</p>`;
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
