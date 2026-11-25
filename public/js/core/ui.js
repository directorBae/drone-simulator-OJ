// 1·2일차 공통 UI 조각: 콘솔, 편집기(+문법검사), 인스펙터, 분할선, 실행 워커 래퍼
export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const BASE = new URL('..', import.meta.url).href; // .../js/

// =====================================================================  로딩 화면 (#boot)
// 페이지 HTML 에 정적으로 들어 있어 JS 가 뜨기 전부터 보임. Runner 가 Python 준비 상태를 알려 주고, 준비되면 사라짐
export const bootScreen = {
  doneFlag: false, dismissed: false, held: false,
  get el() { return document.getElementById('boot'); },
  /** 진행 상황 (pct: 0~100, 없으면 그대로) */
  update(text, pct) {
    window.__bootTouched = true;
    const el = this.el;
    if (el) {
      if (text) el.querySelector('#bootMsg').textContent = text;
      if (pct != null) el.querySelector('#bootBar').style.width = pct + '%';
    }
    const mini = document.getElementById('bootMini');
    if (mini && text) mini.textContent = `드론 시뮬레이터 준비 중 · ${text}`;
  },
  done() {
    if (this.doneFlag) return;
    this.doneFlag = true;
    this.update('준비 완료', 100);
    const mini = document.getElementById('bootMini');
    if (mini) mini.textContent = '✓ 드론 시뮬레이터 준비 완료';
    setTimeout(() => this._hide(), 250);
  },
  fail(text) {
    const el = this.el;
    if (!el || this.doneFlag) return;
    el.classList.add('failed');
    el.querySelector('#bootMsg').textContent = text;
    el.querySelector('#bootRetry').hidden = false;
    if (!this.held) el.hidden = false;
  },
  /** 잠시 숨김 (2일차 로그인 화면 동안). show() 로 다시 보임 — 이미 준비됐으면 안 보임 */
  hold() { this.held = true; this._hide(true); },
  show() { this.held = false; const el = this.el; if (el && !this.doneFlag && !this.dismissed) el.hidden = false; },
  _hide(keep) {
    const el = this.el;
    if (el) el.hidden = true;
    if (!keep) refreshEditors();
  },
  init() {
    const el = this.el;
    if (!el) return;
    el.querySelector('#bootSkip').onclick = () => { this.dismissed = true; this._hide(); };
    el.querySelector('#bootRetry').onclick = () => location.reload();
  },
};
bootScreen.init();
// CodeMirror CSS 는 렌더링을 막지 않게 늦게 붙으므로, 붙은 뒤·로딩 화면이 사라진 뒤 편집기 크기를 다시 계산
function refreshEditors() { document.querySelectorAll('.CodeMirror').forEach((el) => el.CodeMirror && el.CodeMirror.refresh()); }
window.addEventListener('cm-css', refreshEditors);

// =====================================================================  console
export class Console {
  constructor(el) { this.el = el; }
  line(text, cls, t) {
    const el = this.el;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 30;
    const div = document.createElement('div');
    div.className = cls;
    if (t !== undefined) {
      const ts = document.createElement('span');
      ts.className = 'c-time';
      ts.textContent = 't+' + t.toFixed(1);
      div.appendChild(ts);
    }
    div.appendChild(document.createTextNode(text));
    el.appendChild(div);
    while (el.childElementCount > 3000) el.firstChild.remove();
    if (atBottom) el.scrollTop = el.scrollHeight;
    return div;
  }
  out(t) { return this.line(t, 'c-out'); }
  err(t) { return this.line(t, 'c-err'); }
  sys(t) { return this.line(t, 'c-sys'); }
  div(t) { return this.line(t, 'c-div'); }
  clear() { this.el.innerHTML = ''; }
}

// =====================================================================  linter (별도 워커)
class Linter {
  constructor() {
    this.ready = false;
    this.seq = 0;
    this.pending = null;
    this.listeners = [];
    this.worker = null;
  }
  start() {
    if (this.worker) return;
    this.worker = new Worker(BASE + 'core/lint-worker.js');
    this.worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'ready') { this.ready = true; this.listeners.forEach((f) => f(m)); }
      else if (m.type === 'result' && this.pending && m.id === this.pending.id) { this.pending.cb(m.diagnostics); this.pending = null; }
    };
  }
  check(code, cb) {
    if (!this.ready) { cb(null); return; }
    const id = ++this.seq;
    this.pending = { id, cb };
    this.worker.postMessage({ id, code });
  }
}
export const linter = new Linter();

/** CodeMirror 5 편집기 (Python, 문법 검사, 오류 줄 표시) */
export function createEditor(host, { onRun, onSubmit, onChange, summaryEl } = {}) {
  let errorLine = null;
  const lintFn = (text, update, _opts, cm) => {
    linter.check(text, (diags) => {
      if (!diags) { update([]); return; }
      const anns = diags.map((d) => {
        const line = clamp(d.line - 1, 0, cm.lineCount() - 1);
        const len = (cm.getLine(line) || '').length;
        const ch = clamp((d.col || 1) - 1, 0, len);
        return { from: CodeMirror.Pos(line, ch), to: CodeMirror.Pos(line, Math.max(len, ch + 1)), message: d.msg, severity: d.sev };
      });
      update(anns);
      if (summaryEl) {
        const errs = diags.filter((d) => d.sev === 'error').length, warns = diags.length - errs;
        if (errs) { summaryEl.className = 'lint-summary err'; summaryEl.textContent = `✖ 오류 ${errs}${warns ? ` · 경고 ${warns}` : ''} (빨간 표시에 마우스를 올려 보세요)`; }
        else if (warns) { summaryEl.className = 'lint-summary warn'; summaryEl.textContent = `⚠ 경고 ${warns}`; }
        else { summaryEl.className = 'lint-summary ok'; summaryEl.textContent = '✓ 문법 검사 통과'; }
      }
    });
  };
  const cm = CodeMirror(host, {
    mode: { name: 'python', version: 3 }, theme: 'material-darker',
    lineNumbers: true, indentUnit: 4, tabSize: 4, indentWithTabs: false,
    matchBrackets: true, autoCloseBrackets: true, styleActiveLine: true,
    gutters: ['CodeMirror-lint-markers', 'CodeMirror-linenumbers'],
    lint: { getAnnotations: lintFn, async: true, delay: 500 },
    extraKeys: {
      Tab: (c) => (c.somethingSelected() ? c.indentSelection('add') : c.replaceSelection('    ', 'end')),
      'Shift-Tab': (c) => c.indentSelection('subtract'),
      'Ctrl-Enter': () => onRun && onRun(), 'Cmd-Enter': () => onRun && onRun(),
      'Shift-Ctrl-Enter': () => onSubmit && onSubmit(), 'Shift-Cmd-Enter': () => onSubmit && onSubmit(),
      'Ctrl-/': 'toggleComment', 'Cmd-/': 'toggleComment',
    },
  });
  linter.listeners.push(() => cm.performLint());
  new ResizeObserver(() => cm.refresh()).observe(host);
  cm.on('change', (_c, ch) => { clearError(); if (onChange && ch.origin !== 'setValue') onChange(); });
  function clearError() { if (errorLine) cm.removeLineClass(errorLine, 'background', 'cm-error-line'); errorLine = null; }
  cm.markError = (line) => {
    clearError();
    if (!line || line > cm.lineCount()) return;
    errorLine = cm.addLineClass(line - 1, 'background', 'cm-error-line');
    cm.scrollIntoView({ line: line - 1, ch: 0 }, 80);
  };
  cm.clearError = clearError;
  return cm;
}

// =====================================================================  runner (Python 워커)
export class Runner {
  /** sim: World 옵션 (1일차) 또는 null (2일차) */
  constructor({ sim = null, onMessage, onStatus }) {
    this.simOpts = sim;
    this.onMessage = onMessage;
    this.onStatus = onStatus || (() => {});
    this.ready = false;
    this.busy = false;
    this.version = '';
    this.waiters = [];
    this.lastSnap = null;
    this.start(sim);
  }
  start(sim) {
    if (this.worker) this.worker.terminate();
    this.ready = false; this.busy = false;
    this.worker = new Worker(BASE + 'core/runner-worker.js');
    this.worker.onmessage = (e) => this._msg(e.data);
    this.worker.onerror = (e) => { this.onStatus('error', '워커 오류: ' + (e.message || e)); bootScreen.fail('Python 실행기를 시작하지 못했습니다: ' + (e.message || e)); };
    this.worker.postMessage({ type: 'init', sim });
    this.onStatus('loading', 'Python 로딩 중…');
    bootScreen.update('Python 엔진 시작하는 중…', 20);
  }
  _msg(m) {
    if (m.type === 'state') this.lastSnap = m.snap;
    if (m.type === 'pystatus') { this.onStatus('loading', m.text); bootScreen.update(m.text, m.pct); }
    if (m.type === 'ready') {
      this.ready = true; this.version = m.version;
      this.onStatus('ready', '● ' + m.version);
      bootScreen.done();
      this.waiters.splice(0).forEach((r) => r());
      linter.start();
    }
    if (m.type === 'pyerror') { this.onStatus('error', 'Python 로드 실패'); bootScreen.fail('Python 엔진을 불러오지 못했습니다. 인터넷 연결을 확인하고 다시 시도하세요. (' + m.text + ')'); }
    if (m.type === 'finished') { this.busy = false; if (this._done) { const d = this._done; this._done = null; d(m); } }
    this.onMessage(m);
  }
  whenReady() { return this.ready ? Promise.resolve() : new Promise((r) => this.waiters.push(r)); }
  /** 실행. finished 메시지로 resolve 되는 Promise 를 돌려줌 */
  run({ files, entry = 'main.py', stdin = '', capture = false, captureLimit = 0 }) {
    this.busy = true;
    return new Promise((resolve) => { this._done = resolve; this.worker.postMessage({ type: 'run', files, entry, stdin, capture, captureLimit }); });
  }
  repl(code) { this.busy = true; this.worker.postMessage({ type: 'repl', code }); }
  inject(hex) { this.worker.postMessage({ type: 'inject', hex }); }
  reset(sim) {
    this.simOpts = sim;
    if (this.busy) this.restart(sim); else this.worker.postMessage({ type: 'reset', sim });
  }
  /** 실행 중인 Python 을 강제로 멈추고 다시 시작 (시뮬레이터 상태는 유지) */
  restart(sim) {
    const d = this._done; this._done = null;
    this.start(sim);
    if (d) d({ type: 'finished', error: { kind: 'STOP', text: '중지됨' }, aborted: true });
  }
}

export function setPill(el, cls, text) { el.className = 'pill ' + cls; el.textContent = text; }

// =====================================================================  inspector
export class Inspector {
  constructor(el, filters) { this.el = el; this.filters = filters; }
  add(ev) {
    const f = this.filters();
    if (ev.dir === 'TX' && !f.tx) return;
    if (ev.dir === 'RX' && (!f.rx || (ev.telem && !f.telem))) return;
    if (f.sysid && ev.dir === 'RX' && ev.sysid !== f.sysid) return;
    const el = this.el;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 30;
    const row = document.createElement('div');
    row.className = `irow ${ev.dir.toLowerCase()}${ev.bad ? ' bad' : ''}`;
    const who = ev.dir === 'RX' ? `#${ev.sysid}` : ev.source === 'builder' ? '작성기' : (ev.target !== undefined ? `→#${ev.target}` : '');
    row.innerHTML = `<div class="ih"><span class="it">t+${ev.t.toFixed(2)}</span><span class="idir">${ev.dir === 'TX' ? 'TX →' : '← RX'}</span><span class="iwho">${esc(who)}</span><span class="iname">${esc(ev.name)}</span><span class="isum">${esc(ev.bad || summary(ev.fields))}</span></div>`;
    row.firstChild.onclick = () => toggleDetail(row, ev);
    el.appendChild(row);
    while (el.childElementCount > 400) el.firstChild.remove();
    if (atBottom) el.scrollTop = el.scrollHeight;
  }
  clear() { this.el.innerHTML = ''; }
}
function fmt(v) {
  if (Array.isArray(v)) { let n = v.length; while (n > 0 && !v[n - 1]) n--; return '[' + v.slice(0, Math.max(n, 1)).join(',') + (n < v.length ? ',…' : '') + ']'; }
  return typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(3) : String(v);
}
function summary(fields) {
  if (!fields) return '';
  const s = Object.entries(fields).map(([k, v]) => `${k}=${fmt(v)}`).join(', ');
  return s.length > 170 ? s.slice(0, 168) + '…' : s;
}
function toggleDetail(row, ev) {
  const ex = row.querySelector('.idetail');
  if (ex) { ex.remove(); return; }
  const d = document.createElement('div');
  d.className = 'idetail';
  const tbl = ev.fields ? '<table>' + Object.entries(ev.fields).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(fmt(v))}</td></tr>`).join('') + '</table>' : '';
  d.innerHTML = `${tbl}<div class="hex">${hexHtml(ev.hex)}</div>${HEX_LEGEND} · 총 ${ev.hex.length / 2} 바이트</div>`;
  row.appendChild(d);
}
export const HEX_LEGEND = '<div class="hex-legend"><span class="hx-stx">STX</span><span class="hx-len">LEN</span><span class="hx-flg">FLAGS</span><span class="hx-seq">SEQ</span><span class="hx-sys">SYS/COMP</span><span class="hx-id">MSGID</span><span class="hx-pay">PAYLOAD</span><span class="hx-crc">CRC</span>';
export function hexHtml(hex) {
  const b = hex.match(/../g) || [];
  const v2 = b[0] === 'fd';
  const len = parseInt(b[1], 16);
  const hdr = v2 ? 10 : 6;
  const cls = (i) => {
    if (i === 0) return 'stx';
    if (i === 1) return 'len';
    if (v2) { if (i <= 3) return 'flg'; if (i === 4) return 'seq'; if (i <= 6) return 'sys'; if (i <= 9) return 'id'; }
    else { if (i === 2) return 'seq'; if (i <= 4) return 'sys'; if (i === 5) return 'id'; }
    if (i < hdr + len) return 'pay';
    if (i < hdr + len + 2) return 'crc';
    return 'sig';
  };
  return b.map((x, i) => `<span class="hx-${cls(i)}">${x}</span>`).join('');
}

// =====================================================================  splitters
export function splitter(handle, onMove) {
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const move = (ev) => onMove(ev);
    const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
}
export function setupSplitters({ main, layout, left, leftSplit, leftTop, right, rightSplit }) {
  const root = document.documentElement.style;
  if (main) splitter(main, (e) => { const r = layout.getBoundingClientRect(); root.setProperty('--left', clamp(((e.clientX - r.left) / r.width) * 100, 20, 80) + '%'); });
  if (leftSplit) splitter(leftSplit, (e) => {
    const r = left.getBoundingClientRect();
    const top = leftTop ? leftTop.getBoundingClientRect().bottom : r.top;
    root.setProperty('--editorH', clamp(e.clientY - top, 80, r.bottom - top - 80) + 'px');
  });
  if (rightSplit) splitter(rightSplit, (e) => { const r = right.getBoundingClientRect(); root.setProperty('--viewH', clamp(((e.clientY - r.top) / r.height) * 100, 20, 90) + '%'); });
}
