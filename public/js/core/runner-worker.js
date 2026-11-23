/*
 * Python 실행 워커 (Pyodide)
 *  - sim 옵션이 있으면 가상 드론 월드(sim.js)를 같은 스레드에서 돌림 (1일차)
 *    Python 이 time.sleep / recv_match 하는 동안에도 브리지 호출마다 시뮬레이션이 진행됨
 *  - 여러 파일/폴더로 된 프로젝트 실행, stdin 입력, stdout 캡처 (2일차 채점용)
 *
 * main → worker : init{sim}, reset{sim}, run{files, entry, stdin, capture}, repl{code}, inject{hex}
 * worker → main : state{snap, events}, stdout{text}, stderr{text}, pystatus, ready, pyerror, started, finished{error, ms, stdout}
 */
const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
const PROJ = '/home/pyodide/proj';
importScripts('mavlink.js', 'sim.js');

let world = null;
let bootWall = 0;
let pyodide = null, runUser = null, runRepl = null;
let busy = false, lastPost = 0, stdinText = null;
let capture = null, streamed = 0;
const STREAM_LINES = 400, STREAM_CHARS = 2000;

const nowSec = () => performance.now() / 1000;
function advance() { if (world) world.advanceTo(nowSec() - bootWall); }
function post(force) {
  if (!world) return;
  const n = performance.now();
  if (!force && n - lastPost < 33) return;
  lastPost = n;
  postMessage({ type: 'state', snap: world.snapshot(), events: world.takeEvents() });
}

const sleeper = (() => {
  try { if (self.crossOriginIsolated) return new Int32Array(new SharedArrayBuffer(4)); } catch (e) { /* no SAB */ }
  return null;
})();
function pause(ms) {
  if (ms <= 0) return;
  if (sleeper) Atomics.wait(sleeper, 0, 0, ms);
  else { const end = performance.now() + ms; while (performance.now() < end) { /* spin */ } }
}

// Python 쪽 pymavlink 호환 모듈이 사용 (from js import simBridge)
self.simBridge = {
  connect(dev) {
    if (!world) throw new Error('이 화면에는 드론 시뮬레이터가 연결되어 있지 않습니다');
    advance();
    world.openLink(String(dev));
    world.log('info', `가상 링크 연결: '${dev}' → 드론 ${world.vehicles.length}대 (sysid ${world.vehicles.map((v) => v.s.sysid).join(', ')})`);
    post(true);
  },
  write(hex) { if (!world) return; advance(); world.receive(MAVLink.fromHex(String(hex)), 'code'); post(); },
  read() {
    if (!world) return '';
    advance();
    const out = world.drainOut();
    post();
    return out.length ? MAVLink.toHex(out) : '';
  },
  sleep(sec) {
    const end = performance.now() + sec * 1000;
    for (;;) {
      advance(); post();
      const left = end - performance.now();
      if (left <= 0) break;
      pause(Math.min(left, 10));
    }
  },
};

function resetWorld(opts) {
  if (!opts) { world = null; return; }
  world = new World(opts);
  bootWall = nowSec() - world.t;
  post(true);
}

const SETUP = String.raw`
import sys, os, time, json, traceback, builtins
PROJ = '/home/pyodide/proj'
sys.path.insert(0, '/home/pyodide')
from js import simBridge

def _sim_sleep(seconds):
    seconds = float(seconds)
    if seconds < 0:
        raise ValueError("sleep length must be non-negative")
    simBridge.sleep(seconds)
time.sleep = _sim_sleep

def connect(device='udpin:0.0.0.0:14550', **kwargs):
    """실습 환경이 제공하는 연결: 가상 드론과 MAVLink 링크를 엽니다 (mavutil.mavlink_connection 과 같음)"""
    from pymavlink import mavutil
    return mavutil.mavlink_connection(device, **kwargs)
builtins.connect = connect

_user_globals = {'__name__': '__main__'}

def _rel(path):
    return path[len(PROJ) + 1:] if path.startswith(PROJ + '/') else path

def _format_exc(e):
    tb = traceback.extract_tb(e.__traceback__)
    frames = [f for f in tb if f.filename.startswith(PROJ + '/') or f.filename == '<stdin>']
    out = []
    if frames:
        out.append('Traceback (most recent call last):\n')
        for f in frames:
            out.append('  File "%s", line %d, in %s\n' % (_rel(f.filename), f.lineno, f.name))
            if f.line:
                out.append('    %s\n' % f.line.strip())
    exc_lines = traceback.format_exception_only(type(e), e)
    out.extend(l.replace(PROJ + '/', '') for l in exc_lines)
    file = line = None
    if frames:
        file, line = _rel(frames[-1].filename), frames[-1].lineno
    if isinstance(e, SyntaxError) and e.filename and e.filename.startswith(PROJ + '/'):
        file, line = _rel(e.filename), e.lineno
    return ''.join(out).rstrip(), file, line

def _purge_modules():
    for name, mod in list(sys.modules.items()):
        f = getattr(mod, '__file__', None) or ''
        if name == 'pymavlink' or name.startswith('pymavlink.') or f.startswith(PROJ + '/'):
            del sys.modules[name]

def _run_user(entry):
    global _user_globals
    _purge_modules()
    os.chdir(PROJ)
    if PROJ not in sys.path:
        sys.path.insert(0, PROJ)
    path = PROJ + '/' + entry
    g = {'__name__': '__main__', '__file__': path, '__builtins__': builtins}
    _user_globals = g
    try:
        try:
            with open(path, encoding='utf-8') as fp:
                src = fp.read()
            code = compile(src, path, 'exec')
        except SyntaxError as e:
            text, file, line = _format_exc(e)
            return json.dumps({'kind': 'CE', 'text': text, 'file': file, 'line': line})
        exec(code, g)
    except SystemExit as e:
        if e.code not in (None, 0):
            return json.dumps({'kind': 'RE', 'text': 'SystemExit: %s' % (e.code,), 'file': None, 'line': None})
    except BaseException as e:
        text, file, line = _format_exc(e)
        kind = 'CE' if isinstance(e, SyntaxError) else 'RE'
        return json.dumps({'kind': kind, 'text': text, 'file': file, 'line': line})
    finally:
        sys.stdout.flush()
        sys.stderr.flush()
    return None

def _repl(src):
    try:
        try:
            code = compile(src, '<stdin>', 'eval')
            r = eval(code, _user_globals)
            if r is not None:
                print(repr(r))
        except SyntaxError:
            exec(compile(src, '<stdin>', 'exec'), _user_globals)
    except SystemExit:
        pass
    except BaseException as e:
        print(_format_exc(e)[0], file=sys.stderr)
    finally:
        sys.stdout.flush()
        sys.stderr.flush()
`;

function onStdout(s) {
  if (capture) capture.push(s);
  if (streamed < STREAM_LINES) {
    postMessage({ type: 'stdout', text: s.length > STREAM_CHARS ? s.slice(0, STREAM_CHARS) + ` … (이 줄은 ${s.length}자, 콘솔에는 일부만 표시)` : s });
  } else if (streamed === STREAM_LINES) {
    postMessage({ type: 'stderr', text: `… 출력이 ${STREAM_LINES}줄을 넘어 콘솔 표시를 생략합니다 (채점에는 전체가 사용됩니다)` });
  }
  streamed++;
}

async function initPython() {
  try {
    postMessage({ type: 'pystatus', text: 'Python 다운로드 중…' });
    importScripts(PYODIDE_URL + 'pyodide.js');
    pyodide = await loadPyodide({ indexURL: PYODIDE_URL });
    pyodide.setStdout({ batched: onStdout });
    pyodide.setStderr({ batched: (s) => postMessage({ type: 'stderr', text: s }) });
    pyodide.setStdin({ stdin: () => { const t = stdinText; stdinText = null; return t; } });
    pyodide.FS.mkdirTree('/home/pyodide/pymavlink');
    pyodide.FS.mkdirTree(PROJ);
    for (const f of ['__init__.py', 'mavlink.py', 'mavutil.py']) {
      const res = await fetch('../../py/pymavlink/' + f, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`py/pymavlink/${f} 를 불러오지 못했습니다 (${res.status})`);
      pyodide.FS.writeFile('/home/pyodide/pymavlink/' + f, await res.text());
    }
    self.MAVLINK_DEFS_JSON = MAVLink.defsJSON;
    pyodide.runPython(SETUP);
    runUser = pyodide.globals.get('_run_user');
    runRepl = pyodide.globals.get('_repl');
    const ver = pyodide.runPython('import sys; sys.version.split()[0]');
    postMessage({ type: 'ready', version: `Python ${ver} (Pyodide ${pyodide.version})` });
  } catch (e) {
    postMessage({ type: 'pyerror', text: String((e && e.message) || e) });
  }
}

function rmTree(path) {
  const FS = pyodide.FS;
  for (const name of FS.readdir(path)) {
    if (name === '.' || name === '..') continue;
    const p = path + '/' + name;
    if (FS.isDir(FS.stat(p).mode)) { rmTree(p); FS.rmdir(p); } else FS.unlink(p);
  }
}
function writeProject(files) {
  rmTree(PROJ);
  for (const [rel, content] of Object.entries(files)) {
    if (!/^[\w\-. /가-힣]+$/.test(rel) || rel.includes('..') || rel.startsWith('/')) continue;
    const full = PROJ + '/' + rel;
    const dir = full.slice(0, full.lastIndexOf('/'));
    pyodide.FS.mkdirTree(dir);
    pyodide.FS.writeFile(full, content);
  }
}

self.onmessage = (e) => {
  const m = e.data;
  switch (m.type) {
    case 'init':
      resetWorld(m.sim);
      setInterval(() => { if (!busy) { advance(); post(); } }, 20);
      initPython();
      break;
    case 'reset':
      resetWorld(m.sim);
      break;
    case 'inject':
      if (world) { advance(); world.receive(MAVLink.fromHex(m.hex), 'builder'); post(true); }
      break;
    case 'run': {
      busy = true;
      stdinText = m.stdin ? (m.stdin.endsWith('\n') ? m.stdin : m.stdin + '\n') : null;
      capture = m.capture ? [] : null;
      streamed = 0;
      let err = null;
      try { writeProject(m.files); } catch (ex) { err = { kind: 'RE', text: '프로젝트 파일 쓰기 실패: ' + ex }; }
      advance(); post(true);
      postMessage({ type: 'started' });
      const t0 = performance.now();
      if (!err) {
        try {
          const r = runUser(m.entry || 'main.py');
          err = r ? JSON.parse(r) : null;
        } catch (ex) {
          err = { kind: 'RE', text: String(ex), file: null, line: null };
        }
      }
      const ms = performance.now() - t0;
      busy = false;
      if (world) world.closeLink();
      advance(); post(true);
      postMessage({ type: 'finished', error: err, ms, stdout: capture ? capture.join('\n') : null });
      capture = null;
      break;
    }
    case 'repl':
      busy = true;
      try { runRepl(m.code); } catch (ex) { postMessage({ type: 'stderr', text: String(ex) }); }
      busy = false;
      advance(); post(true);
      postMessage({ type: 'finished', repl: true });
      break;
  }
};
