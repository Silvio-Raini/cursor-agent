import { getDb } from '../db.js';
import { env } from '../config.js';
import { maskApiKey } from '../auth.js';

const KEY = 'cursor_api_key';

export function getCursorApiKey(): string {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(KEY) as { value: string } | undefined;
  const fromDb = row?.value?.trim() || '';
  if (fromDb) return fromDb;
  return env.CURSOR_API_KEY.trim();
}

export function setCursorApiKey(value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    )
    .run(KEY, value.trim());
}

export function getSettingsPublic() {
  const key = getCursorApiKey();
  return {
    hasApiKey: Boolean(key),
    apiKeyMasked: maskApiKey(key),
    defaultModel: env.AGENT_DEFAULT_MODEL,
    maxConcurrent: env.AGENT_MAX_CONCURRENT,
    allowAnyPath: env.AGENT_ALLOW_ANY_PATH,
    hasWorkspaceAllowlist: env.WORKSPACES.split(',').some((s) => s.trim()),
    publicUrl: env.PUBLIC_URL,
  };
}
