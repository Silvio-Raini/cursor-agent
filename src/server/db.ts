import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import argon2 from 'argon2';
import { env } from './config.js';

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: 'admin' | 'user';
  created_at: string;
}

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) throw new Error('DB not initialized');
  return db;
}

export function initDatabase(): void {
  fs.mkdirSync(path.dirname(env.DATABASE_PATH), { recursive: true });
  db = new Database(env.DATABASE_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','user')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      csrf_token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agent_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Neue Session',
      cwd TEXT NOT NULL,
      workspace_label TEXT,
      model TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('idle','running','finished','error','cancelled')) DEFAULT 'idle',
      created_by_user_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_run_at TEXT
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE ON UPDATE CASCADE,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('queued','running','finished','error','cancelled')) DEFAULT 'queued',
      error_message TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS agent_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE ON UPDATE CASCADE,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(run_id, seq)
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON agent_sessions(created_by_user_id);
    CREATE INDEX IF NOT EXISTS idx_runs_session ON agent_runs(session_id);
  `);

  bootstrapAdmin();
}

async function bootstrapAdmin(): Promise<void> {
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
  if (count.c > 0) return;
  const hash = await argon2.hash(env.BOOTSTRAP_PASSWORD, { type: argon2.argon2id });
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(
    env.BOOTSTRAP_USERNAME,
    hash,
    'admin',
  );
  console.log(`[bootstrap] Admin "${env.BOOTSTRAP_USERNAME}" created — change password after first login.`);
}
