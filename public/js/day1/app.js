import { $, Console, createEditor, Runner, Inspector, setPill, setupSplitters } from '../core/ui.js';
import { Day1Scene } from './scene1.js';
import { EXAMPLES } from './examples.js';
import { LinkViz } from './linkviz.js';
import { MessageBuilder } from './builder.js';
import { Missions } from './missions.js';

const RUN_LIMIT_SEC = 120; // 실행 시간 제한
const MODE_NAMES = { 0: 'STABILIZE', 1: 'ACRO', 2: 'ALT_HOLD', 3: 'AUTO', 4: 'GUIDED', 5: 'LOITER', 6: 'RTL', 7: 'CIRCLE', 9: 'LAND', 16: 'POSHOLD', 17: 'BRAKE' };
const SEVERITY = ['EMERGENCY', 'ALERT', 'CRITICAL', 'ERROR', 'WARNING', 'NOTICE', 'INFO', 'DEBUG'];
const store = {
  get: (k, d) => { try { return localStorage.getItem('day1.' + k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('day1.' + k, v); } catch { /* ignore */ } },
};

const con = new Console($('console'));
const scene = new Day1Scene($('view3d'));
const link = new LinkViz($('linkviz'));
const inspector = new Inspector($('inspector'), () => ({ tx: $('fTX').checked, rx: $('fRX').checked, telem: $('fTelem').checked }));
const missions = new Missions($('missionList'), () => scene.setMissionMarkers(missions.markers()));
scene.setMissionMarkers(missions.markers());

let drones = +store.get('drones', '1');
let running = false, runTimer = null, lastSnap = null;
const simOpts = () => ({ count: drones, spacing: 3 });

// ------------------------------------------------------------------ editor
const editor = createEditor($('editor'), { onRun: run, summaryEl: $('lintSummary'), onChange: () => store.set('code', editor.getValue()) });
editor.setValue(store.get('code', EXAMPLES[0].code));
editor.clearHistory();

// ------------------------------------------------------------------ runner
const runner = new Runner({
  sim: simOpts(),
  onStatus: (cls, text) => setPill($('pyStatus'), cls, text),
  onMessage: onRunner,
});

function onRunner(m) {
  switch (m.type) {
    case 'state': {
      lastSnap = m.snap;
      scene.setState(m.snap);
      updateHud(m.snap);
      link.updateStats(m.snap.stats);
      for (const ev of m.events) onEvent(ev);
      missions.onSnap(m.snap);
      break;
    }
    case 'stdout': con.out(m.text); scene.say(m.text); break;
    case 'stderr': con.err(m.text); break;
    case 'ready': buttons(); break;
    case 'pyerror': con.err('Python(Pyodide)을 불러오지 못했습니다: ' + m.text + '\n인터넷 연결(cdn.jsdelivr.net)을 확인하세요.'); break;
    case 'finished': {
      clearTimeout(runTimer);
      running = false;
      buttons();
      if (m.repl || m.aborted) break;
      setPill($('pyStatus'), 'ready', '● ' + runner.version);
      if (m.error) { con.err(m.error.text); if (!m.error.file || m.error.file === 'main.py') editor.markError(m.error.line); }
      con.div(m.error ? `✖ ${m.error.kind === 'CE' ? '문법 오류' : '에러로 종료'} (${(m.ms / 1000).toFixed(1)}s)` : `■ 실행 완료 (${(m.ms / 1000).toFixed(1)}s) — 드론은 마지막 명령을 계속 수행합니다`);
      break;
    }
  }
}

function onEvent(ev) {
  missions.onEvent(ev);
  switch (ev.kind) {
    case 'msg':
      inspector.add(ev);
      link.packet(ev);
      if (ev.dir === 'TX' || !ev.telem) scene.pulse(ev.dir === 'TX' ? 'up' : 'down', ev.dir === 'TX' ? ev.target : ev.sysid, true);
      else if (Math.random() < 0.25) scene.pulse('down', ev.sysid, false);
      break;
    case 'log': con.line('[sim] ' + ev.text, 'c-sim ' + ev.level, ev.t); break;
    case 'status': con.line(`[드론${lastSnap && lastSnap.vehicles.length > 1 ? ' #' + ev.sysid : ''} STATUSTEXT/${SEVERITY[ev.severity]}] ${ev.text}`, 'c-status', ev.t); break;
    case 'link': link.setOpen(ev.open, ev.dev); break;
    case 'collision': toast(`💥 드론 #${ev.a} 와 #${ev.b} 충돌!`); break;
    case 'bad': break;
  }
  if (ev.kind === 'msg' && ev.bad) toast(`⚠ 잘못된 MAVLink 메시지: ${ev.bad} (${ev.name})`);
}

// ------------------------------------------------------------------ run / stop / reset
function buttons() {
  $('btnRun').disabled = !runner.ready || running;
  $('btnStop').disabled = !running;
  $('replInput').disabled = !runner.ready || running;
}
async function run() {
  if (!runner.ready || running) return;
  editor.clearError();
  store.set('code', editor.getValue());
  con.div('▶ 실행 main.py');
  running = true;
  buttons();
  setPill($('pyStatus'), 'running', '실행 중…');
  runTimer = setTimeout(() => {
    con.err(`⏱ 실행 시간 제한 ${RUN_LIMIT_SEC}초를 넘어 중지했습니다 (무한 루프나 너무 긴 sleep 을 확인하세요)`);
    stop(true);
  }, RUN_LIMIT_SEC * 1000);
  runner.run({ files: { 'main.py': editor.getValue() } });
}
function stop(quiet) {
  if (!running) return;
  clearTimeout(runTimer);
  if (quiet !== true) con.sys('■ 중지했습니다. Python 을 다시 시작합니다 (드론은 마지막 명령을 계속 수행)');
  running = false;
  link.setOpen(false);
  runner.restart(lastSnap ? { states: lastSnap.vehicles, t: lastSnap.t, collisions: lastSnap.collisions } : simOpts());
  buttons();
}
function resetDrones() {
  clearTimeout(runTimer);
  running = false;
  runner.reset(simOpts());
  scene.clearTrails();
  missions.reset();
  link.setOpen(false);
  link.setDrones(drones);
  builder.refreshTargets();
  con.sys(`↺ 드론 ${drones}대를 초기 상태로 되돌렸습니다`);
  buttons();
}
$('btnRun').onclick = run;
$('btnStop').onclick = () => stop();
$('btnReset').onclick = resetDrones;
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !editor.hasFocus()) { e.preventDefault(); run(); }
});

// ------------------------------------------------------------------ examples / drones
const exSel = $('exampleSelect');
exSel.add(new Option('📂 예제 · 테스트 코드…', ''));
EXAMPLES.forEach((ex, i) => exSel.add(new Option(ex.title, String(i))));
exSel.onchange = () => {
  const ex = EXAMPLES[+exSel.value];
  exSel.value = '';
  if (!ex) return;
  if (editor.getValue().trim() && !confirm(`'${ex.title}' 로 바꿀까요? 지금 코드는 사라집니다.`)) return;
  editor.setValue(ex.code);
  store.set('code', ex.code);
  if (ex.drones !== drones) { drones = ex.drones; $('droneCount').value = String(drones); store.set('drones', drones); resetDrones(); }
};
$('droneCount').value = String(drones);
$('droneCount').onchange = (e) => { drones = +e.target.value; store.set('drones', drones); resetDrones(); };
link.setDrones(drones);

// ------------------------------------------------------------------ tabs
document.querySelectorAll('.tab[data-tab]').forEach((t) => {
  t.onclick = () => {
    document.querySelectorAll('.tab[data-tab]').forEach((x) => x.classList.toggle('active', x === t));
    document.querySelectorAll('.tabpane').forEach((p) => { p.hidden = p.id !== t.dataset.tab; });
    if (t.dataset.tab === 'paneCode') editor.refresh();
  };
});

// ------------------------------------------------------------------ builder
const builder = new MessageBuilder($('builder'), {
  getDrones: () => drones,
  onSend: (hex, name) => {
    if (running) con.sys(`(코드가 실행 중이라 ${name} 은(는) 코드가 끝난 뒤에 전달됩니다)`);
    runner.inject(hex);
  },
});

// ------------------------------------------------------------------ REPL
const replHist = [];
let replIdx = 0;
$('replInput').addEventListener('keydown', (e) => {
  const inp = e.target;
  if (e.key === 'Enter') {
    if (!inp.value.trim() || !runner.ready || running) return;
    replHist.push(inp.value); replIdx = replHist.length;
    con.line('>>> ' + inp.value, 'c-echo');
    running = true; buttons();
    runner.repl(inp.value);
    inp.value = '';
  } else if (e.key === 'ArrowUp') { if (replIdx > 0) inp.value = replHist[--replIdx]; e.preventDefault(); }
  else if (e.key === 'ArrowDown') { replIdx = Math.min(replHist.length, replIdx + 1); inp.value = replHist[replIdx] ?? ''; e.preventDefault(); }
});

// ------------------------------------------------------------------ HUD
function updateHud(snap) {
  const sel = $('hudDrone');
  if (sel.options.length !== snap.vehicles.length) {
    sel.innerHTML = '';
    snap.vehicles.forEach((v, i) => sel.add(new Option(`#${v.sysid}`, String(i))));
  }
  sel.hidden = snap.vehicles.length < 2;
  const s = snap.vehicles[+sel.value || 0];
  $('hudMode').textContent = MODE_NAMES[s.mode] ?? `MODE ${s.mode}`;
  const b = $('hudArmed');
  if (s.crashed) { b.className = 'badge crash'; b.textContent = 'CRASHED'; }
  else { b.className = 'badge ' + (s.armed ? 'on' : 'off'); b.textContent = s.armed ? 'ARMED' : 'DISARMED'; }
  $('hudSys').textContent = `SYSID ${s.sysid}${s.landed ? ' · 지상' : ' · 비행 중'}`;
  $('hudAlt').textContent = (-s.pos[2]).toFixed(1) + ' m';
  $('hudSpd').textContent = `${Math.hypot(s.vel[0], s.vel[1]).toFixed(1)} m/s  ↕ ${(-s.vel[2]).toFixed(1)}`;
  $('hudHdg').textContent = String(Math.round((((s.yaw * 180) / Math.PI) % 360 + 360) % 360)).padStart(3, '0') + '°';
  $('hudNed').textContent = [s.pos[0] - s.home[0], s.pos[1] - s.home[1], s.pos[2]].map((v) => v.toFixed(1)).join(', ');
  $('hudBat').textContent = `${s.battery.toFixed(0)}%`;
  const led = $('hudLed');
  led.style.background = s.ledOn ? `rgb(${s.ledColor.join(',')})` : '#222';
  led.style.boxShadow = s.ledOn ? `0 0 10px rgb(${s.ledColor.join(',')})` : 'none';
}

// ------------------------------------------------------------------ misc
let toastTimer;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}
$('btnClearConsole').onclick = () => con.clear();
$('chkSimLog').onchange = (e) => $('console').classList.toggle('hide-sim', !e.target.checked);
$('btnClearInsp').onclick = () => inspector.clear();
$('chkFollow').onchange = (e) => { scene.follow = e.target.checked; };
$('btnView').onclick = () => scene.resetView();
$('btnTrail').onclick = () => scene.clearTrails();
setupSplitters({ main: $('splitMain'), layout: $('layout'), left: $('left'), leftSplit: $('splitLeft'), leftTop: $('leftTabs'), right: $('right'), rightSplit: $('splitRight') });
con.sys('1일차 MAVLink 실습 — 코드를 실행하거나 [메시지 작성기] 탭에서 메시지를 바로 보내 보세요. Python 준비 중 (처음엔 10초 정도 걸릴 수 있어요)…');
