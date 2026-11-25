/*
 * 공식 채점 큐 (2일차 ✔ 제출)
 *  - 제출 하나 = 채점 케이스 7개(공개 2 + 비공개 5)를 서버에서 차례로 실행 → 채점
 *  - 케이스가 끝날 때마다 DB 의 results 를 갱신 (결과 화면이 1초마다 읽어 감)
 *  - 컴파일 에러는 첫 케이스에서 나면 나머지도 모두 컴파일 에러 (실행하지 않음)
 *  - 동시에 채점하는 제출 수 = size (기본 10, JUDGE_WORKERS). 칸(slot)마다 다른 격리 사용자로 실행
 *    시간 제한은 CPU 시간이라 CPU 수보다 많이 동시에 돌려도 공정함 (오래 걸리는 제출이 짧은 제출을 막지 않게 칸을 넉넉히)
 *  - 경로 검사(judge.js)는 메모리를 많이 쓸 수 있어 따로 작은 워커 풀(JUDGE_POOL, 기본 CPU 수 − 1, 최대 4)에서
 */
import os from 'node:os';
import { db } from './db.js';
import { GRADED_CASES, caseInput } from './cases.js';
import { runPython } from './sandbox.js';
import { JudgePool } from './judge-pool.js';
import { MAX_OUTPUT_CHARS } from '../public/js/day2/judge.js';

export const CPU_LIMIT_SEC = +process.env.JUDGE_TIMEOUT_SEC || 15;

export class Grader {
  constructor({ size, onProgress = () => {}, onDone = () => {} } = {}) {
    this.size = size || 10;
    this.queue = [];
    this.running = new Set();
    this.freeSlots = Array.from({ length: this.size }, (_, i) => i);
    this.pool = new JudgePool({ size: +process.env.JUDGE_POOL || Math.max(1, Math.min(4, os.availableParallelism() - 1)) });
    this.onProgress = onProgress;
    this.onDone = onDone;
  }

  enqueue(id) {
    if (!this.queue.includes(id) && !this.running.has(id)) this.queue.push(id);
    this._next();
  }
  /** id 앞에 기다리는 제출 수 (채점 중이면 0) */
  ahead(id) { const i = this.queue.indexOf(id); return i < 0 ? 0 : i + 1; }

  _next() {
    while (this.running.size < this.size && this.queue.length) {
      const id = this.queue.shift();
      const slot = this.freeSlots.shift();
      this.running.add(id);
      this._grade(id, slot)
        .catch((e) => {
          console.error('채점 실패', id, e);
          db.prepare("UPDATE submissions SET status = 'error', error = ? WHERE id = ?").run('채점 중 서버 오류: ' + String((e && e.message) || e).slice(0, 300), id);
          this.onDone(id, null);
        })
        .finally(() => { this.running.delete(id); this.freeSlots.push(slot); this.freeSlots.sort((a, b) => a - b); this._next(); });
    }
  }

  async _grade(id, slot = 0) {
    const row = db.prepare('SELECT files FROM submissions WHERE id = ?').get(id);
    if (!row) return;
    const files = JSON.parse(row.files);
    const results = GRADED_CASES.map((c) => ({ caseId: c.id, name: c.name, hidden: !c.public, state: 'WAIT' }));
    const save = () => db.prepare('UPDATE submissions SET results = ? WHERE id = ?').run(JSON.stringify(results), id);
    save();
    let ce = null;
    for (let k = 0; k < GRADED_CASES.length; k++) {
      const c = GRADED_CASES[k], r = results[k];
      if (ce) {
        Object.assign(r, { state: 'CE', verdict: 'CE', message: ce.message, errType: ce.errType, errFile: ce.errFile, errLine: ce.errLine, computeMs: 0 });
        continue;
      }
      r.state = 'RUN';
      save(); this.onProgress(id);
      const input = caseInput(c);
      const run = await runPython({ files, stdin: JSON.stringify(input), timeoutMs: CPU_LIMIT_SEC * 1000, slot, maxOut: MAX_OUTPUT_CHARS + 1 });
      r.computeMs = run.ms;
      if (run.status === 'ok') {
        const j = await this.pool.run(input, run.stdout).catch((e) => ({ verdict: 'RV', kind: 'server', message: e.message }));
        Object.assign(r, j, { state: j.verdict });
      } else if (run.status === 'TLE') {
        Object.assign(r, { state: 'TLE', verdict: 'TLE', message: `경로 계산이 ${CPU_LIMIT_SEC}초(CPU 시간) 안에 끝나지 않았습니다` });
      } else {
        const e = run.error || {};
        Object.assign(r, { state: run.status, verdict: run.status, message: String(e.text || '').slice(-2000), errType: e.etype || null, errFile: e.file || null, errLine: e.line || null });
        if (run.status === 'CE') ce = r;
      }
      save(); this.onProgress(id);
    }
    const passed = results.filter((r) => r.verdict === 'AC');
    const total = passed.reduce((s, r) => s + r.missionTime, 0);
    db.prepare("UPDATE submissions SET results = ?, ac_count = ?, all_ac = ?, total_time = ?, status = 'done' WHERE id = ?")
      .run(JSON.stringify(results), passed.length, passed.length === results.length ? 1 : 0, total, id);
    this.onDone(id, { passCount: passed.length, total });
  }
}
