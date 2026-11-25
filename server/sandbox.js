/*
 * 학생 파이썬 프로젝트를 서버에서 실행 (2일차 공식 채점)
 *
 *  - 실행마다 임시 폴더를 만들어 파일을 쓰고 python3 -I harness.py <폴더> 로 실행
 *  - 시간 제한: 벽시계 timeoutMs (넘으면 프로세스 그룹째 강제 종료 → TLE)
 *  - 출력 한도: stdout 이 maxOut 자를 넘으면 그만 읽고 종료 (채점기가 '출력이 너무 큽니다' 로 판정)
 *  - 격리 (리눅스 + root 로 실행 중일 때): SANDBOX_USER 사용자 권한으로 실행, 환경 변수 비움,
 *    harness 가 메모리·CPU·파일·프로세스 수를 제한. 서버 코드·DB 는 이 사용자가 읽을 수 없게 권한을 둠 (Dockerfile 참고)
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

fs.mkdirSync(RUN_ROOT, { recursive: true });

/** 격리 사용자 (root 로 실행 중이고 그 사용자가 있을 때만) */
function sandboxIds() {
  const name = process.env.SANDBOX_USER || 'sandbox';
  if (process.platform === 'win32' || typeof process.getuid !== 'function' || process.getuid() !== 0) return null;
  try {
    const uid = +execFileSync('id', ['-u', name]).toString().trim();
    const gid = +execFileSync('id', ['-g', name]).toString().trim();
    return Number.isInteger(uid) && uid > 0 ? { uid, gid, name } : null;
  } catch { return null; }
}
export const SANDBOX = sandboxIds();
export const SANDBOX_INFO = SANDBOX ? `격리 사용자 '${SANDBOX.name}'(uid ${SANDBOX.uid})로 실행` : '⚠ 격리 없이 서버와 같은 사용자로 실행 (개발용 — 운영은 Docker 로)';

function writeProject(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    if (!/^[\w\-. /가-힣]+$/.test(rel) || rel.includes('..') || rel.startsWith('/')) continue;
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
}
function chownTree(p, uid, gid) {
  fs.chownSync(p, uid, gid);
  if (fs.statSync(p).isDirectory()) for (const n of fs.readdirSync(p)) chownTree(path.join(p, n), uid, gid);
}

/**
 * 한 번 실행. 반환: { status: 'ok'|'CE'|'RE'|'TLE', stdout, ms, error?: {text, file, line, etype}, overflow }
 */
export function runPython({ files, stdin, timeoutMs = 30_000, maxOut = 40_000_001 }) {
  const dir = fs.mkdtempSync(path.join(RUN_ROOT, 'run-'));
  writeProject(dir, files);
  if (SANDBOX) chownTree(dir, SANDBOX.uid, SANDBOX.gid);

  return new Promise((resolve) => {
    const t0 = performance.now();
    // -I 는 PYTHON* 환경 변수를 무시하므로 UTF-8 · .pyc 안 만들기는 명령줄 옵션으로
    const child = spawn(PYTHON, ['-I', '-B', '-X', 'utf8', HARNESS, dir], {
      cwd: dir,
      env: {
        PATH: process.platform === 'win32' ? process.env.PATH : '/usr/local/bin:/usr/bin:/bin',
        ...(process.platform === 'win32' ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}),
        HOME: dir, LANG: 'C.UTF-8',
        JUDGE_MEM_MB: MEM_MB, JUDGE_CPU_SEC: String(Math.ceil(timeoutMs / 1000) + 1),
      },
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32', // 프로세스 그룹째 종료하려고
      windowsHide: true,
      ...(SANDBOX ? { uid: SANDBOX.uid, gid: SANDBOX.gid } : {}),
    });
    const out = []; let outLen = 0, overflow = false;
    let report = '';
    let timedOut = false, done = false;
    const kill = () => {
      try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* 이미 끝남 */ } }
    };
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);

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

    const finish = (code, signal) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const ms = Math.round(performance.now() - t0);
      fs.rm(dir, { recursive: true, force: true }, () => {});
      let stdout = out.join('');
      if (overflow) stdout = stdout.slice(0, maxOut);
      if (timedOut) return resolve({ status: 'TLE', stdout: '', ms });
      if (overflow) return resolve({ status: 'ok', stdout, ms, overflow: true });
      let rep = null;
      for (const line of report.trim().split('\n').reverse()) { try { rep = JSON.parse(line); break; } catch { /* 다음 줄 */ } }
      if (rep && (rep.kind === 'CE' || rep.kind === 'RE')) return resolve({ status: rep.kind, stdout, ms, error: { text: String(rep.text || ''), file: rep.file || null, line: rep.line || null, etype: rep.etype || null } });
      if (signal === 'SIGXCPU') return resolve({ status: 'TLE', stdout: '', ms });
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
