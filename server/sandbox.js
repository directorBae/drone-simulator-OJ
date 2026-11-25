/*
 * 학생 파이썬 프로젝트를 서버에서 실행 (2일차 공식 채점)
 *
 *  - 실행마다 임시 폴더를 만들어 파일을 쓰고 python3 -I harness.py <폴더> 로 실행
 *  - 시간 제한: CPU 시간 timeoutMs (리눅스 RLIMIT_CPU → SIGXCPU → TLE). 동시에 여러 건을 채점해 CPU 를 나눠 써도
 *    억울한 시간 초과가 나지 않도록 벽시계가 아니라 CPU 시간으로 잼.
 *    잠만 자는 코드(sleep · input 대기)는 CPU 를 안 쓰므로 벽시계 wallMs(기본 timeoutMs × 5)로 한 번 더 막음.
 *    (Windows 개발 환경은 RLIMIT 이 없어 벽시계 timeoutMs 만)
 *  - 끝나면 프로세스 그룹째 정리 (학생 코드가 띄운 자식 프로세스가 남지 않게)
 *  - 출력 한도: stdout 이 maxOut 자를 넘으면 그만 읽고 종료 (채점기가 '출력이 너무 큽니다' 로 판정)
 *  - 격리 (리눅스 + root 로 실행 중일 때): 채점 칸(slot)마다 다른 사용자(sandbox1, sandbox2, …)로 실행, 환경 변수 비움,
 *    harness 가 메모리·CPU·파일·프로세스 수를 제한. 서버 코드·DB 는 이 사용자들이 읽을 수 없게 권한을 둠 (Dockerfile 참고)
 *    · 칸마다 사용자가 달라서: 한 학생의 fork 폭탄(프로세스 수 한도)이 동시에 채점 중인 다른 학생에게 번지지 않고,
 *      다른 칸의 실행 폴더(다른 학생 코드)를 읽을 수 없음
 *    · 실행 폴더는 root 소유 · 읽기 전용 → 학생 코드는 어디에도 파일을 쓸 수 없음 (디스크 채우기 차단, /tmp 도 막음)
 *  - 그 밖(Windows 개발 환경 등)에서는 같은 사용자로 실행 — 개발용
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HARNESS = process.env.SANDBOX_HARNESS || path.join(HERE, 'harness.py');
const PYTHON = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
const RUN_ROOT = process.env.SANDBOX_DIR || path.join(os.tmpdir(), 'droneoj-runs');
const MEM_MB = process.env.JUDGE_MEM_MB || '1024';
// 한 번 실행에서 쓸 수 있는 프로세스 · 스레드 수 (칸마다 사용자가 달라 칸별로 따로 셈). 여러 프로세스로 CPU 를 독차지하지 못하게 작게
const NPROC = process.env.JUDGE_NPROC || '8';

fs.mkdirSync(RUN_ROOT, { recursive: true });

/** 격리 사용자 목록 (root 로 실행 중이고 그 사용자가 있을 때만): sandbox1 … sandboxN, 없으면 sandbox 하나 */
function sandboxIds() {
  const name = process.env.SANDBOX_USER || 'sandbox';
  if (process.platform === 'win32' || typeof process.getuid !== 'function' || process.getuid() !== 0) return null;
  const look = (n) => {
    try {
      const uid = +execFileSync('id', ['-u', n], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      const gid = +execFileSync('id', ['-g', n], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      return Number.isInteger(uid) && uid > 0 ? { uid, gid, name: n } : null;
    } catch { return null; }
  };
  const list = [];
  for (let i = 1; i <= 64; i++) { const u = look(name + i); if (!u) break; list.push(u); }
  if (!list.length) { const u = look(name); if (u) list.push(u); }
  return list.length ? list : null;
}
export const SANDBOX = sandboxIds();
export const SANDBOX_INFO = SANDBOX
  ? `격리 사용자 ${SANDBOX.length}명(uid ${SANDBOX[0].uid}~${SANDBOX[SANDBOX.length - 1].uid})으로 채점 칸마다 따로 실행`
  : '⚠ 격리 없이 서버와 같은 사용자로 실행 (개발용 — 운영은 Docker 로)';
const HAS_RLIMIT = process.platform !== 'win32';

function writeProject(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    if (!/^[\w\-. /가-힣]+$/.test(rel) || rel.includes('..') || rel.startsWith('/')) continue;
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
}
/** 실행 폴더를 root 소유 · 그 칸의 그룹만 읽기 (쓰기 불가) */
function lockTree(p, gid) {
  const dir = fs.statSync(p).isDirectory();
  fs.chownSync(p, 0, gid);
  fs.chmodSync(p, dir ? 0o750 : 0o640);
  if (dir) for (const n of fs.readdirSync(p)) lockTree(path.join(p, n), gid);
}

/**
 * 한 번 실행. 반환: { status: 'ok'|'CE'|'RE'|'TLE', stdout, ms, error?: {text, file, line, etype}, overflow }
 */
export function runPython({ files, stdin, timeoutMs = 15_000, wallMs, slot = 0, maxOut = 40_000_001 }) {
  const dir = fs.mkdtempSync(path.join(RUN_ROOT, 'run-'));
  writeProject(dir, files);
  const who = SANDBOX ? SANDBOX[slot % SANDBOX.length] : null;
  if (who) lockTree(dir, who.gid);
  const wall = wallMs || (HAS_RLIMIT ? timeoutMs * (+process.env.JUDGE_WALL_FACTOR || 5) : timeoutMs);

  return new Promise((resolve) => {
    const t0 = performance.now();
    // -I 는 PYTHON* 환경 변수를 무시하므로 UTF-8 · .pyc 안 만들기는 명령줄 옵션으로
    const child = spawn(PYTHON, ['-I', '-B', '-X', 'utf8', HARNESS, dir], {
      cwd: dir,
      env: {
        PATH: process.platform === 'win32' ? process.env.PATH : '/usr/local/bin:/usr/bin:/bin',
        ...(process.platform === 'win32' ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}),
        HOME: dir, LANG: 'C.UTF-8',
        JUDGE_MEM_MB: MEM_MB, JUDGE_CPU_SEC: String(Math.ceil(timeoutMs / 1000)), JUDGE_NPROC: NPROC,
      },
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32', // 프로세스 그룹째 종료하려고
      windowsHide: true,
      ...(who ? { uid: who.uid, gid: who.gid } : {}),
    });
    const out = []; let outLen = 0, overflow = false;
    let report = '';
    let timedOut = false, done = false;
    const kill = () => {
      try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* 이미 끝남 */ } }
    };
    // 이 칸의 사용자로 돌고 있는 프로세스를 모두 종료 (setsid 로 프로세스 그룹을 빠져나간 자식까지).
    // 그 사용자 권한으로 kill(-1) 을 부르면 커널이 그 사용자의 프로세스 전부에 신호를 보냄 — 칸마다 사용자가 달라 다른 학생에게는 영향 없음
    let swept = Promise.resolve();
    const sweep = () => {
      if (!who) return Promise.resolve();
      return new Promise((res) => {
        const k = spawn(PYTHON, ['-I', '-S', '-c', 'import os\ntry:\n os.kill(-1, 9)\nexcept OSError:\n pass'], { uid: who.uid, gid: who.gid, stdio: 'ignore', env: {}, cwd: '/' });
        k.on('close', res); k.on('error', res);
      });
    };
    const timer = setTimeout(() => { timedOut = true; kill(); swept = sweep(); }, wall);
    // 메인 프로세스가 끝나면 남은 자식 프로세스도 정리 (자식이 출력 파이프를 붙잡고 있으면 'close' 가 안 오므로)
    child.on('exit', () => {
      if (process.platform !== 'win32') { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* 이미 없음 */ } }
      swept = sweep();
    });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (s) => {
      if (overflow) return;
      out.push(s); outLen += s.length;
      if (outLen > maxOut) { overflow = true; kill(); }
    });
    child.stderr.on('data', () => { /* 학생 디버그 출력은 버림 */ });
    child.stdio[3].setEncoding('utf8');
    child.stdio[3].on('data', (s) => { if (report.length < 20_000) report += s; });
    child.stdin.on('error', () => { /* 입력을 다 읽기 전에 끝난 프로그램 */ });
    child.stdin.end(stdin);

    const finish = async (code, signal) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      await swept; // 남은 프로세스가 다 정리된 뒤에 칸을 돌려줌
      const ms = Math.round(performance.now() - t0);
      fs.rm(dir, { recursive: true, force: true }, () => {});
      let stdout = out.join('');
      if (overflow) stdout = stdout.slice(0, maxOut);
      if (timedOut) return resolve({ status: 'TLE', stdout: '', ms });
      if (overflow) return resolve({ status: 'ok', stdout, ms, overflow: true });
      let rep = null;
      for (const line of report.trim().split('\n').reverse()) { try { rep = JSON.parse(line); break; } catch { /* 다음 줄 */ } }
      if (rep && (rep.kind === 'CE' || rep.kind === 'RE')) return resolve({ status: rep.kind, stdout, ms, error: { text: String(rep.text || ''), file: rep.file || null, line: rep.line || null, etype: rep.etype || null } });
      // SIGXCPU = CPU 시간 한도, SIGKILL = (SIGXCPU 를 무시한 경우) CPU 하드 한도 — 둘 다 시간 초과
      if (signal === 'SIGXCPU' || (HAS_RLIMIT && signal === 'SIGKILL')) return resolve({ status: 'TLE', stdout: '', ms });
      if (code !== 0) {
        const why = signal ? `신호 ${signal}` : `종료 코드 ${code}`;
        return resolve({ status: 'RE', stdout, ms, error: { text: `프로그램이 비정상 종료되었습니다 (${why}). 메모리(${MEM_MB}MB)를 넘었을 수 있습니다.`, etype: 'Crash' } });
      }
      resolve({ status: 'ok', stdout, ms });
    };
    child.on('close', finish);
    child.on('error', (e) => {
      if (done) return;
      done = true; clearTimeout(timer);
      fs.rm(dir, { recursive: true, force: true }, () => {});
      resolve({ status: 'RE', stdout: '', ms: 0, error: { text: '서버에서 파이썬을 실행하지 못했습니다: ' + e.message, etype: 'ServerError' } });
    });
  });
}
