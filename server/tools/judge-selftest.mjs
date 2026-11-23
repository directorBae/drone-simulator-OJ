// 채점기 자체 테스트: node server/tools/judge-selftest.mjs <solution.py>
import { execFileSync } from 'node:child_process';
import { CASES, caseInput } from '../cases.js';
import { judgeCase } from '../../public/js/day2/judge.js';
const sol = process.argv[2];
let total = 0;
for (const c of CASES) {
  const input = caseInput(c);
  const t0 = Date.now();
  const out = execFileSync('python', [sol], { input: JSON.stringify(input), maxBuffer: 1 << 26 }).toString();
  const r = judgeCase(input, out);
  total += r.missionTime || 0;
  console.log(`case ${c.id} ${c.name}: ${r.verdict} — ${r.message} (계산 ${Date.now() - t0}ms)`);
  if (r.verdict === 'AC') {
    // 일부러 망가뜨리기
    const o = JSON.parse(out);
    const bad1 = structuredClone(o); bad1.paths[3][2][1] += 50;
    const bad2 = structuredClone(o); bad2.paths[5] = bad2.paths[5].slice(0, -1);
    const bad3 = structuredClone(o); bad3.paths[1] = bad3.paths[2].map((w) => [w[0], w[1] - 1.9, w[2], w[3]]); bad3.paths[1][0] = [0, 2, 0, 0];
    for (const [n, b] of [['far waypoint', bad1], ['no return', bad2], ['bad copy', bad3], ['not json', 'hello'], ['missing', { p: 1 }]]) {
      const rr = judgeCase(input, typeof b === 'string' ? b : JSON.stringify(b));
      console.log(`   ↳ ${n}: ${rr.verdict}/${rr.kind} ${rr.message.slice(0, 110)}`);
    }
  }
}
console.log('미션 시간 합', total.toFixed(2));
