// SQLite (Node 내장 node:sqlite) — 별도 설치 없이 파일 하나(DATA_DIR/droneoj.db)에 저장
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
fs.mkdirSync(DATA_DIR, { recursive: true });
export const db = new DatabaseSync(path.join(DATA_DIR, 'droneoj.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    pw_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER,              -- NULL 이면 관리자 세션
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS projects (
    user_id INTEGER PRIMARY KEY,
    files TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    files TEXT NOT NULL,
    results TEXT NOT NULL,
    ac_count INTEGER NOT NULL,
    all_ac INTEGER NOT NULL,
    total_time REAL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_sub_user ON submissions(user_id);
  CREATE TABLE IF NOT EXISTS submit_tokens (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);
// 비동기 채점용 열 (예전 DB 에도 추가). status: judging(채점 중) | done(채점 완료) | error(제출 오류)
{
  const cols = db.prepare('PRAGMA table_info(submissions)').all().map((c) => c.name);
  if (!cols.includes('status')) db.exec("ALTER TABLE submissions ADD COLUMN status TEXT NOT NULL DEFAULT 'done'");
  if (!cols.includes('error')) db.exec('ALTER TABLE submissions ADD COLUMN error TEXT');
}

// ------------------------------------------------------------------ 설정
export const DEFAULT_SETTINGS = {
  day2_open_at: '2026-12-01T00:00:00+09:00', // 2일차 화면 공개 시각
  leaderboard_open_at: '',                   // 리더보드 자동 공개 시각 (비우면 수동)
  leaderboard_mode: 'auto',                  // auto | open | closed
  submit_deadline: '',                       // 제출 마감 (비우면 없음)
  day1_solutions: 'closed',                  // 1일차 해설(정답) 예제: open | closed
};
export function getSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return out;
}
export function setSetting(key, value) {
  if (!(key in DEFAULT_SETTINGS)) throw new Error('unknown setting ' + key);
  db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

// ------------------------------------------------------------------ 비밀번호
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return salt.toString('hex') + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
}
export function checkPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const h = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 32);
  return crypto.timingSafeEqual(h, Buffer.from(hash, 'hex'));
}
export const now = () => new Date().toISOString();
export const newToken = () => crypto.randomBytes(24).toString('base64url');
