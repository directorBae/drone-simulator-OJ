/*
 * 첫 화면에서 미리 받아 두는 무거운 파일들 (Pyodide · three.js · CodeMirror)
 *  - 브라우저 HTTP 캐시에 넣어 두기만 함. 1·2일차 화면의 <script>, importScripts, 모듈 import 가 같은 주소를 쓰므로
 *    그대로 캐시에서 읽음 (CDN 이 1년 캐시 + CORS * + Vary: Accept-Encoding)
 *  - 실제로 읽는 방식에 맞춰 받음 (Firefox 는 쿠키를 보내는 요청/안 보내는 요청의 캐시를 따로 둠)
 *      fetch  : fetch()·모듈 import 로 읽는 것 → 쿠키 없는 CORS fetch (받은 바이트로 진행률 표시)
 *      script : <script>·importScripts 로 읽는 것 → <link rel=preload as=script>
 *      style  : <link rel=stylesheet> → <link rel=preload as=style>
 *  - 주소를 바꾸면 이 목록도 함께 바꾸세요: day1/day2/uranusadmin index.html, js/core/runner-worker.js, js/core/lint-worker.js
 */
const PY = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
const CM = 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/';
const TH = 'https://cdn.jsdelivr.net/npm/three@0.160.0/';

// [주소, 크기(바이트, 압축 해제 기준 · 진행률 계산용 대략값), 읽는 방식]
export const ASSETS = [
  [PY + 'pyodide.asm.wasm', 10_088_051, 'fetch'],
  [PY + 'python_stdlib.zip', 2_341_872, 'fetch'],
  [PY + 'pyodide.asm.js', 1_229_099, 'script'],
  [PY + 'pyodide-lock.json', 106_335, 'fetch'],
  [PY + 'pyodide.js', 14_761, 'script'],
  [PY + 'micropip-0.6.0-py3-none-any.whl', 125_054, 'fetch'],
  [PY + 'packaging-23.2-py3-none-any.whl', 194_236, 'fetch'],
  [TH + 'build/three.module.js', 1_272_972, 'fetch'],
  [TH + 'examples/jsm/controls/OrbitControls.js', 29_868, 'fetch'],
  [TH + 'examples/jsm/renderers/CSS2DRenderer.js', 4_407, 'fetch'],
  [CM + 'codemirror.min.js', 170_000, 'script'],
  [CM + 'mode/python/python.min.js', 12_000, 'script'],
  [CM + 'addon/lint/lint.min.js', 8_000, 'script'],
  [CM + 'addon/edit/matchbrackets.min.js', 4_000, 'script'],
  [CM + 'addon/edit/closebrackets.min.js', 5_000, 'script'],
  [CM + 'addon/selection/active-line.min.js', 2_000, 'script'],
  [CM + 'addon/comment/comment.min.js', 5_000, 'script'],
  [CM + 'codemirror.min.css', 6_000, 'style'],
  [CM + 'theme/material-darker.min.css', 4_000, 'style'],
  [CM + 'addon/lint/lint.min.css', 3_000, 'style'],
];

/** <link rel=preload> 로 받기 (classic script·stylesheet 와 같은 요청 방식) */
function preloadLink(url, as) {
  return new Promise((resolve, reject) => {
    const l = document.createElement('link');
    l.rel = 'preload'; l.as = as; l.href = url;
    l.onload = () => resolve();
    l.onerror = () => reject(new Error('preload failed ' + url));
    document.head.appendChild(l);
  });
}

/** 받아서 버림 (캐시에 남김). 받은 바이트 수를 onBytes 로 알림 */
async function warm(url, onBytes) {
  const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  if (!res.body) { const b = await res.arrayBuffer(); onBytes(b.byteLength); return; }
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onBytes(value.byteLength);
  }
}

/** 2일차 문법 검사기가 PyPI 에서 받는 pyflakes 휠 (실패해도 무시) */
async function warmPyflakes() {
  try {
    const meta = await (await fetch('https://pypi.org/pypi/pyflakes/json', { credentials: 'omit' })).json();
    const whl = (meta.urls || []).find((u) => u.packagetype === 'bdist_wheel');
    if (whl) await warm(whl.url, () => {});
  } catch { /* 선택 사항 */ }
}

/**
 * 모두 미리 받기. onProgress({ ratio, loaded, total, done, failed })
 * 반환: 실패한 주소 목록
 */
export async function preloadAll(onProgress = () => {}) {
  const total = ASSETS.reduce((s, [, n]) => s + n, 0);
  const got = new Map();
  const failed = [];
  let finished = 0;
  const report = (done = false) => {
    let loaded = 0;
    for (const [url, n] of ASSETS) loaded += Math.min(got.get(url) || 0, n);
    onProgress({ ratio: Math.min(1, loaded / total), loaded, total, files: finished, fileCount: ASSETS.length, done, failed });
  };
  report();
  await Promise.all([
    ...ASSETS.map(([url, n, kind]) => (kind === 'fetch' ? warm(url, (b) => { got.set(url, (got.get(url) || 0) + b); report(); }) : preloadLink(url, kind))
      .then(() => { got.set(url, n); })
      .catch(() => { failed.push(url); })
      .finally(() => { finished++; report(); })),
    warmPyflakes(),
  ]);
  report(true);
  return failed;
}
