/* 문법/정적 검사 워커: compile() 로 SyntaxError, pyflakes 로 정의되지 않은 이름 등을 찾습니다. */
const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
importScripts(PYODIDE_URL + 'pyodide.js');

let check = null;

const CHECK_SRC = String.raw`
import ast, json, builtins
builtins.connect = None   # 실습 환경이 제공하는 connect()
try:
    from pyflakes import checker as _checker, messages as _msgs
    HAVE_PYFLAKES = True
except Exception:
    HAVE_PYFLAKES = False

_KO = {
    'UndefinedName': "정의되지 않은 이름: '%s'",
    'UndefinedLocal': "지역 변수 '%s' 를 값이 들어가기 전에 사용했습니다",
    'UnusedImport': "'%s' 를 import 했지만 사용하지 않습니다",
    'UnusedVariable': "지역 변수 '%s' 에 값을 넣었지만 사용하지 않습니다",
    'ImportShadowedByLoopVar': "import 한 '%s' 가 반복 변수로 덮어써졌습니다",
}
_ERRORS = {'UndefinedName', 'UndefinedLocal', 'UndefinedExport'}

def _check(src):
    out = []
    try:
        tree = ast.parse(src, 'main.py')
    except SyntaxError as e:
        out.append({'line': e.lineno or 1, 'col': e.offset or 1, 'msg': '%s: %s' % (type(e).__name__, e.msg), 'sev': 'error'})
        return json.dumps(out)
    if HAVE_PYFLAKES:
        w = _checker.Checker(tree, filename='main.py')
        for m in sorted(w.messages, key=lambda m: (m.lineno, m.col)):
            name = type(m).__name__
            try:
                text = _KO[name] % m.message_args[:1] if name in _KO else m.message % m.message_args
            except Exception:
                text = m.message % m.message_args
            out.append({'line': m.lineno, 'col': (m.col or 0) + 1, 'msg': text, 'sev': 'error' if name in _ERRORS else 'warning'})
    return json.dumps(out)
`;

(async () => {
  try {
    const py = await loadPyodide({ indexURL: PYODIDE_URL });
    let flakes = false;
    try {
      await py.loadPackage('micropip');
      await py.pyimport('micropip').install('pyflakes');
      flakes = true;
    } catch (e) { /* 인터넷이 막혀 있으면 문법 검사만 */ }
    py.runPython(CHECK_SRC);
    check = py.globals.get('_check');
    postMessage({ type: 'ready', pyflakes: flakes });
  } catch (e) {
    postMessage({ type: 'failed', text: String(e) });
  }
})();

self.onmessage = (e) => {
  const { id, code } = e.data;
  if (!check) return;
  let diagnostics = [];
  try { diagnostics = JSON.parse(check(code)); } catch (err) { diagnostics = []; }
  postMessage({ type: 'result', id, diagnostics });
};
