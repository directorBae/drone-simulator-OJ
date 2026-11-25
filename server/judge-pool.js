/*
 * 채점 워커 풀 — 학생 프로그램 출력의 채점(JSON 파싱 · 충돌 검사)을 워커 스레드 여러 개에 나눠 줌
 *  - 워커가 멈추거나(시간 초과) 죽으면(메모리 초과 등) 그 채점만 실패시키고 새 워커로 바꿈
 *  - size: 동시에 채점하는 수 (기본: CPU 수 − 1, 최대 4)
 */
import { Worker } from 'node:worker_threads';
import os from 'node:os';

const WORKER_URL = new URL('./judge-worker.js', import.meta.url);

export class JudgePool {
  constructor({ size, timeoutMs = 120_000, memoryMb = 3072 } = {}) {
    this.size = size || Math.max(1, Math.min(4, os.availableParallelism() - 1));
    this.timeoutMs = timeoutMs;
    this.memoryMb = memoryMb;
    this.idle = [];
    this.queue = [];
    this.seq = 0;
    this.active = 0;
    for (let i = 0; i < this.size; i++) this._spawn();
  }

  /** 채점 하나: input(케이스 입력), stdout(프로그램 출력) → 채점 결과 */
  run(input, stdout) {
    return new Promise((resolve, reject) => {
      this.queue.push({ id: ++this.seq, input, stdout, resolve, reject });
      this._next();
    });
  }

  _spawn() {
    const w = new Worker(WORKER_URL, { resourceLimits: { maxOldGenerationSizeMb: this.memoryMb } });
    w.job = null;
    w.on('message', (m) => {
      const job = w.job;
      if (!job || m.id !== job.id) return;
      this._release(w);
      if (m.ok) job.resolve(m.value); else job.reject(new Error(m.error));
    });
    w.on('error', (e) => this._fail(w, '채점 중 서버 오류: ' + (e && e.message)));
    w.on('exit', () => this._fail(w, '채점 워커가 종료되었습니다 (메모리 초과일 수 있습니다)'));
    this.idle.push(w);
    this._next();
  }

  _next() {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop();
      const job = this.queue.shift();
      w.job = job;
      this.active++;
      job.timer = setTimeout(() => this._fail(w, `채점이 ${this.timeoutMs / 1000}초 안에 끝나지 않았습니다`), this.timeoutMs);
      w.postMessage({ id: job.id, input: job.input, stdout: job.stdout });
      job.stdout = null;
    }
  }

  _release(w) {
    clearTimeout(w.job.timer);
    w.job = null;
    this.active--;
    this.idle.push(w);
    this._next();
  }

  /** 워커를 버리고 새로 만듦. 맡고 있던 제출은 실패 처리 */
  _fail(w, message) {
    if (w.dead) return;
    w.dead = true;
    const job = w.job;
    w.job = null;
    const i = this.idle.indexOf(w);
    if (i >= 0) this.idle.splice(i, 1);
    if (job) { clearTimeout(job.timer); this.active--; job.reject(new Error(message)); }
    w.removeAllListeners();
    w.on('error', () => {});
    w.terminate().catch(() => {});
    // 일 없이 죽은 워커(로드 실패 등)는 잠깐 쉬었다 다시 만들어 무한 재시작을 막음
    if (job) this._spawn(); else setTimeout(() => this._spawn(), 1000);
  }
}
