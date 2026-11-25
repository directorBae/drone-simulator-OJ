// 채점기·케이스 점검: node server/tools/judge-selftest.mjs <풀이 main.py 또는 프로젝트 폴더>
// 서버와 같은 실행기(sandbox.js)로 7개 케이스(공개 4 + 비공개 3)를 모두 돌려 채점 결과를 보여 줌
import fs from 'node:fs';
import path from 'node:path';
import { CASES, caseInput } from '../cases.js';
import { runPython } from '../sandbox.js';
import { judgeCase } from '../../public/js/day2/judge.js';

const target = process.argv[2];
if (!target) { console.log('사용법: node server/tools/judge-selftest.mjs <main.py 또는 프로젝트 폴더>'); process.exit(1); }
const files = {};
if (fs.statSync(target).isDirectory()) {
  const walk = (dir, rel = '') => { for (const n of fs.readdirSync(dir)) { const p = path.join(dir, n), r = rel ? `${rel}/${n}` : n; if (fs.statSync(p).isDirectory()) { if (!/^(__pycache__|\.git|venv|\.venv)$/.test(n)) walk(p, r); } else if (/\.py$/.test(n)) files[r] = fs.readFileSync(p, 'utf8'); } };
  walk(target);
} else files['main.py'] = fs.readFileSync(target, 'utf8');

let pass = 0, total = 0;
for (const c of CASES) {
  const input = caseInput(c);
  const run = await runPython({ files, stdin: JSON.stringify(input) });
  const tag = `${c.public ? '공개' : '비공개'}${c.graded ? '·채점' : ''}`;
  if (run.status !== 'ok') { console.log(`case ${c.id} ${c.name} [${tag}]: ${run.status} ${(run.error && run.error.text.split('\n').pop()) || ''} (계산 ${run.ms}ms)`); continue; }
  const r = judgeCase(input, run.stdout);
  if (c.graded && r.verdict === 'AC') { pass++; total += r.missionTime; }
  console.log(`case ${c.id} ${c.name} [${tag}]: ${r.verdict} — ${r.message} (계산 ${run.ms}ms)`);
}
console.log(`공식 채점 5개 중 ${pass}개 통과 · 시간 합 ${total.toFixed(2)}s`);
