import type Database from 'better-sqlite3';

/**
 * Additive SQLite-Migrationen. Werden beim Start der Reihe nach ausgeführt.
 * Nie destructive Änderungen ohne Backup-Hinweis — Daten bleiben in data/.
 */
export type Migration = {
  id: string;
  up: (db: Database.Database) => void;
};

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(name) as { ok: number } | undefined;
  return Boolean(row);
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

export const migrations: Migration[] = [
  {
    id: '001_schema_migrations',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          id TEXT PRIMARY KEY,
          applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
  {
    id: '002_base_tables',
    up: (db) => {
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
    },
  },
  {
    id: '003_chat_shares',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS chat_shares (
          session_id TEXT PRIMARY KEY REFERENCES agent_sessions(id) ON DELETE CASCADE ON UPDATE CASCADE,
          token TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          created_by_user_id INTEGER NOT NULL REFERENCES users(id),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          expires_at TEXT
        );

        CREATE TABLE IF NOT EXISTS share_unlocks (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES chat_shares(session_id) ON DELETE CASCADE ON UPDATE CASCADE,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_share_unlocks_session ON share_unlocks(session_id);
      `);
    },
  },
  {
    id: '004_share_can_write',
    up: (db) => {
      if (!columnExists(db, 'chat_shares', 'can_write')) {
        db.exec(`ALTER TABLE chat_shares ADD COLUMN can_write INTEGER NOT NULL DEFAULT 0`);
      }
    },
  },
];

/** Beispiel-Hilfen für künftige Migrationen (Spalten/Tabellen nur ergänzen). */
export const migrationHelpers = { tableExists, columnExists };

export function runMigrations(db: Database.Database): { applied: string[] } {
  // Bootstrap-Tabelle für Tracking (idempotent)
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied: string[] = [];
  const has = db.prepare('SELECT 1 AS ok FROM schema_migrations WHERE id = ?');
  const insert = db.prepare(
    'INSERT INTO schema_migrations (id, applied_at) VALUES (?, datetime(\'now\'))',
  );

  const tx = db.transaction(() => {
    for (const m of migrations) {
      if (has.get(m.id)) continue;
      m.up(db);
      insert.run(m.id);
      applied.push(m.id);
    }
  });
  tx();

  if (applied.length) {
    console.log(`[db] Migrationen angewendet: ${applied.join(', ')}`);
  }
  return { applied };
}
