import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import argon2 from 'argon2';
import { env } from './config.js';
import { runMigrations } from './db/migrations.js';

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
  runMigrations(db);
  void bootstrapAdmin();
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
