/*
 * 채점 워커 (worker_threads): 학생 프로그램 출력 하나를 채점기로 검사. 큰 출력의 JSON 파싱·충돌 검사가
 * 메인 스레드를 막지 않도록 여기서 함.
 *
 * main → worker : { id, input, stdout }
 * worker → main : { id, ok: true, value: { verdict, kind, message, missionTime, collision, drone, t } } | { id, ok: false, error }
 */
import { parentPort } from 'node:worker_threads';
import { judgeCase } from '../public/js/day2/judge.js';

parentPort.on('message', ({ id, input, stdout }) => {
  try {
    const j = judgeCase(input, stdout);
    parentPort.postMessage({
      id, ok: true,
      value: {
        verdict: j.verdict, kind: j.kind, message: j.message, missionTime: j.missionTime ?? null,
        collision: j.collision ? { i: j.collision.i, j: j.collision.j, t: j.collision.t, pos: j.collision.pos } : null,
        drone: j.drone ?? null, t: j.t ?? null,
      },
    });
  } catch (e) {
    parentPort.postMessage({ id, ok: false, error: '채점 중 서버 오류: ' + (e && e.message) });
  }
});
