import { EventEmitter } from 'node:events';
import { nanoid } from 'nanoid';
import { getDb } from '../db.js';
import { env } from '../config.js';
import { AppError } from '../util/errors.js';
import { assertAllowedCwd } from './scopes.js';
import { cancelActiveRun, executeAgentRun, type NormalizedEvent } from './runner.js';

export type SessionRecord = {
  id: string;
  title: string;
  cwd: string;
  workspaceLabel: string | null;
  model: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
};

export type RunRecord = {
  id: string;
  sessionId: string;
  prompt: string;
  status: string;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
};

const cancelledRuns = new Set<string>();
const runEmitters = new Map<string, EventEmitter>();
/** Sessions with an in-memory job currently executing. */
const activeSessionJobs = new Set<string>();

function mapSession(row: Record<string, unknown>): SessionRecord {
  return {
    id: row.id as string,
    title: row.title as string,
    cwd: row.cwd as string,
    workspaceLabel: (row.workspace_label as string) || null,
    model: row.model as string,
    status: row.status as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    lastRunAt: (row.last_run_at as string) || null,
  };
}

function mapRun(row: Record<string, unknown>): RunRecord {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    prompt: row.prompt as string,
    status: row.status as string,
    errorMessage: (row.error_message as string) || null,
    startedAt: row.started_at as string,
    finishedAt: (row.finished_at as string) || null,
  };
}

function deriveTitle(prompt: string): string {
  const line = prompt.trim().split('\n')[0] || 'Neue Session';
  return line.length > 72 ? `${line.slice(0, 69)}…` : line;
}

function getRunEmitter(runId: string): EventEmitter {
  let e = runEmitters.get(runId);
  if (!e) {
    e = new EventEmitter();
    e.setMaxListeners(50);
    runEmitters.set(runId, e);
  }
  return e;
}

function broadcastEvent(runId: string, event: NormalizedEvent): void {
  const row = getDb().prepare('SELECT COALESCE(MAX(seq),0) AS m FROM agent_events WHERE run_id = ?').get(runId) as {
    m: number;
  };
  const seq = row.m + 1;
  getDb()
    .prepare('INSERT INTO agent_events (run_id, seq, type, payload_json) VALUES (?, ?, ?, ?)')
    .run(runId, seq, event.type, JSON.stringify(event));
  getRunEmitter(runId).emit('event', { ...event, seq });
}

export function subscribeRunEvents(runId: string, listener: (ev: NormalizedEvent & { seq?: number }) => void) {
  getRunEmitter(runId).on('event', listener);
  return () => getRunEmitter(runId).off('event', listener);
}

function countRunningRuns(): number {
  return (
    getDb().prepare(`SELECT COUNT(*) AS c FROM agent_runs WHERE status = 'running'`).get() as { c: number }
  ).c;
}

function sessionHasRunning(sessionId: string): boolean {
  const row = getDb()
    .prepare(`SELECT id FROM agent_runs WHERE session_id = ? AND status = 'running' LIMIT 1`)
    .get(sessionId) as { id: string } | undefined;
  return Boolean(row);
}

function nextQueuedRun(sessionId: string): Record<string, unknown> | undefined {
  return getDb()
    .prepare(
      `SELECT * FROM agent_runs
       WHERE session_id = ? AND status = 'queued'
       ORDER BY started_at ASC, id ASC
       LIMIT 1`,
    )
    .get(sessionId) as Record<string, unknown> | undefined;
}

function listSessionIdsWithQueue(): string[] {
  const rows = getDb()
    .prepare(`SELECT DISTINCT session_id AS id FROM agent_runs WHERE status = 'queued'`)
    .all() as { id: string }[];
  return rows.map((r) => r.id);
}

/**
 * Claim next queued run for a session (atomic). Returns null if busy / limit / empty.
 */
function claimNextQueuedRun(sessionId: string): { run: Record<string, unknown>; session: SessionRecord } | null {
  const db = getDb();
  const claim = db.transaction((sid: string) => {
    if (activeSessionJobs.has(sid)) return null;
    const running = db
      .prepare(`SELECT id FROM agent_runs WHERE session_id = ? AND status = 'running' LIMIT 1`)
      .get(sid);
    if (running) return null;
    if (countRunningRuns() >= env.AGENT_MAX_CONCURRENT) return null;

    const next = nextQueuedRun(sid);
    if (!next) return null;

    const updated = db
      .prepare(`UPDATE agent_runs SET status = 'running' WHERE id = ? AND status = 'queued'`)
      .run(next.id as string);
    if (updated.changes !== 1) return null;

    db.prepare(`UPDATE agent_sessions SET status = 'running', updated_at = datetime('now') WHERE id = ?`).run(sid);
    const sessionRow = db.prepare('SELECT * FROM agent_sessions WHERE id = ?').get(sid) as
      | Record<string, unknown>
      | undefined;
    if (!sessionRow) return null;
    return { run: { ...next, status: 'running' }, session: mapSession(sessionRow) };
  });

  return claim(sessionId);
}

export function listSessions(userId: number): SessionRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM agent_sessions WHERE created_by_user_id = ? ORDER BY updated_at DESC LIMIT 100')
    .all(userId) as Record<string, unknown>[];
  return rows.map(mapSession);
}

export function getSession(id: string, userId: number): SessionRecord {
  const row = getDb().prepare('SELECT * FROM agent_sessions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row) throw new AppError('NOT_FOUND', 'Session nicht gefunden.', 404);
  if (row.created_by_user_id !== userId) throw new AppError('FORBIDDEN', 'Kein Zugriff.', 403);
  return mapSession(row);
}

export function listRuns(sessionId: string, userId: number): RunRecord[] {
  getSession(sessionId, userId);
  const rows = getDb()
    .prepare('SELECT * FROM agent_runs WHERE session_id = ? ORDER BY started_at DESC')
    .all(sessionId) as Record<string, unknown>[];
  return rows.map(mapRun);
}

export function getRun(runId: string, userId: number): RunRecord {
  const row = getDb().prepare('SELECT * FROM agent_runs WHERE id = ?').get(runId) as Record<string, unknown> | undefined;
  if (!row) throw new AppError('NOT_FOUND', 'Run nicht gefunden.', 404);
  getSession(row.session_id as string, userId);
  return mapRun(row);
}

export function listRunEvents(runId: string, userId: number) {
  getRun(runId, userId);
  return (
    getDb()
      .prepare('SELECT seq, type, payload_json, created_at FROM agent_events WHERE run_id = ? ORDER BY seq')
      .all(runId) as Array<{ seq: number; type: string; payload_json: string; created_at: string }>
  ).map((r) => ({
    seq: r.seq,
    type: r.type,
    payload: JSON.parse(r.payload_json) as Record<string, unknown>,
    createdAt: r.created_at,
  }));
}

export async function createSession(input: {
  cwd: string;
  workspaceLabel?: string;
  model?: string;
  title?: string;
  prompt?: string;
  userId: number;
}): Promise<{ session: SessionRecord; run?: RunRecord }> {
  const cwd = assertAllowedCwd(input.cwd);
  const model = input.model?.trim() || env.AGENT_DEFAULT_MODEL;
  const title = input.title?.trim() || (input.prompt ? deriveTitle(input.prompt) : 'Neue Session');
  const sessionId = `pending-${nanoid(14)}`;
  const now = new Date().toISOString();

  getDb()
    .prepare(
      `INSERT INTO agent_sessions (id, title, cwd, workspace_label, model, status, created_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'idle', ?, ?, ?)`,
    )
    .run(sessionId, title, cwd, input.workspaceLabel || null, model, input.userId, now, now);

  if (input.prompt?.trim()) {
    const run = await sendPrompt(sessionId, input.prompt.trim(), input.userId);
    return { session: getSession(run.sessionId, input.userId), run };
  }
  return { session: getSession(sessionId, input.userId) };
}

async function runAgentJob(session: SessionRecord, runId: string, prompt: string): Promise<string> {
  const db = getDb();
  let sessionId = session.id;
  activeSessionJobs.add(sessionId);
  cancelledRuns.delete(runId);

  try {
    const result = await executeAgentRun({
      panelRunId: runId,
      agentId: session.id.startsWith('pending-') ? null : session.id,
      cwd: session.cwd,
      model: session.model,
      prompt,
      isCancelled: () => cancelledRuns.has(runId),
      onEvent: (ev) => broadcastEvent(runId, ev),
    });

    if (session.id.startsWith('pending-') || session.id !== result.agentId) {
      const oldId = session.id;
      db.prepare('UPDATE agent_sessions SET id = ? WHERE id = ?').run(result.agentId, oldId);
      db.prepare('UPDATE agent_runs SET session_id = ? WHERE session_id = ?').run(result.agentId, oldId);
      activeSessionJobs.delete(oldId);
      activeSessionJobs.add(result.agentId);
      sessionId = result.agentId;
    }

    const finalStatus = cancelledRuns.has(runId) ? 'cancelled' : result.status;
    const errorMessage = cancelledRuns.has(runId)
      ? 'Abgebrochen'
      : result.errorMessage || null;

    db.prepare(
      `UPDATE agent_runs SET status = ?, error_message = ?, finished_at = datetime('now') WHERE id = ?`,
    ).run(finalStatus, errorMessage, runId);

    const hasMoreQueued = Boolean(nextQueuedRun(sessionId));
    db.prepare(
      `UPDATE agent_sessions SET status = ?, last_run_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
    ).run(hasMoreQueued ? 'running' : finalStatus === 'finished' ? 'finished' : finalStatus, sessionId);

    broadcastEvent(runId, {
      type: 'status',
      text: finalStatus,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    if (cancelledRuns.has(runId)) {
      db.prepare(
        `UPDATE agent_runs SET status = 'cancelled', error_message = 'Abgebrochen', finished_at = datetime('now') WHERE id = ?`,
      ).run(runId);
    } else {
      const msg = err instanceof Error ? err.message : 'Fehler';
      db.prepare(
        `UPDATE agent_runs SET status = 'error', error_message = ?, finished_at = datetime('now') WHERE id = ?`,
      ).run(msg, runId);
      broadcastEvent(runId, { type: 'error', text: msg, timestamp: new Date().toISOString() });
    }

    const hasMoreQueued = Boolean(nextQueuedRun(sessionId));
    db.prepare(`UPDATE agent_sessions SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(
      hasMoreQueued ? 'running' : cancelledRuns.has(runId) ? 'cancelled' : 'error',
      sessionId,
    );
  } finally {
    activeSessionJobs.delete(sessionId);
    setTimeout(() => runEmitters.delete(runId), 60_000);
    queueMicrotask(() => {
      void pumpSessionQueue(sessionId);
      void wakeQueuedSessions();
    });
  }

  return sessionId;
}

/** Start next queued run for a session if possible. */
export function pumpSessionQueue(sessionId: string): void {
  if (activeSessionJobs.has(sessionId)) return;
  if (sessionHasRunning(sessionId)) return;

  const claimed = claimNextQueuedRun(sessionId);
  if (!claimed) return;

  void runAgentJob(claimed.session, claimed.run.id as string, claimed.run.prompt as string);
}

function wakeQueuedSessions(): void {
  for (const sessionId of listSessionIdsWithQueue()) {
    pumpSessionQueue(sessionId);
  }
}

/**
 * After server restart: orphaned `running` jobs are dead; mark them and resume queues.
 */
export function resumeQueuesOnStartup(): void {
  const db = getDb();
  const orphaned = db
    .prepare(`SELECT id, session_id FROM agent_runs WHERE status = 'running'`)
    .all() as Array<{ id: string; session_id: string }>;

  for (const row of orphaned) {
    db.prepare(
      `UPDATE agent_runs SET status = 'error', error_message = ?, finished_at = datetime('now') WHERE id = ?`,
    ).run('Unterbrochen (Server-Neustart)', row.id);
    broadcastEvent(row.id, {
      type: 'error',
      text: 'Unterbrochen (Server-Neustart)',
      timestamp: new Date().toISOString(),
    });
  }

  const sessions = db
    .prepare(
      `SELECT DISTINCT s.id FROM agent_sessions s
       INNER JOIN agent_runs r ON r.session_id = s.id
       WHERE r.status = 'queued'`,
    )
    .all() as Array<{ id: string }>;

  for (const s of sessions) {
    const hasQueued = Boolean(nextQueuedRun(s.id));
    db.prepare(`UPDATE agent_sessions SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(
      hasQueued ? 'running' : 'idle',
      s.id,
    );
  }

  // Sessions stuck in running without active/queued runs
  db.prepare(
    `UPDATE agent_sessions SET status = 'error', updated_at = datetime('now')
     WHERE status = 'running'
       AND id NOT IN (SELECT session_id FROM agent_runs WHERE status IN ('queued','running'))`,
  ).run();

  console.log(
    `[agents] Queue-Resume: ${orphaned.length} verwaiste Runs, ${sessions.length} Sessions mit Warteschlange`,
  );
  wakeQueuedSessions();
}

export async function sendPrompt(sessionId: string, prompt: string, userId: number): Promise<RunRecord> {
  const session = getSession(sessionId, userId);
  const trimmed = prompt.trim();
  if (!trimmed) throw new AppError('VALIDATION_ERROR', 'Prompt leer.', 400);

  if (session.title === 'Neue Session') {
    getDb().prepare('UPDATE agent_sessions SET title = ? WHERE id = ?').run(deriveTitle(trimmed), sessionId);
  }

  const runId = `run-${nanoid(14)}`;
  getDb()
    .prepare('INSERT INTO agent_runs (id, session_id, prompt, status) VALUES (?, ?, ?, ?)')
    .run(runId, sessionId, trimmed, 'queued');

  // Session als beschäftigt markieren solange Queue/Run aktiv
  getDb()
    .prepare(`UPDATE agent_sessions SET status = 'running', updated_at = datetime('now') WHERE id = ?`)
    .run(sessionId);

  pumpSessionQueue(sessionId);

  return mapRun(getDb().prepare('SELECT * FROM agent_runs WHERE id = ?').get(runId) as Record<string, unknown>);
}

export async function cancelRun(runId: string, userId: number): Promise<RunRecord> {
  const run = getRun(runId, userId);
  if (run.status !== 'queued' && run.status !== 'running') {
    throw new AppError('RUN_NOT_ACTIVE', 'Run nicht aktiv.', 400);
  }

  cancelledRuns.add(runId);

  if (run.status === 'queued') {
    getDb()
      .prepare(
        `UPDATE agent_runs SET status = 'cancelled', error_message = 'Abgebrochen', finished_at = datetime('now') WHERE id = ?`,
      )
      .run(runId);
  } else {
    await cancelActiveRun(runId);
    getDb()
      .prepare(
        `UPDATE agent_runs SET status = 'cancelled', error_message = 'Abgebrochen', finished_at = datetime('now') WHERE id = ?`,
      )
      .run(runId);
  }

  broadcastEvent(runId, { type: 'status', text: 'cancelled', timestamp: new Date().toISOString() });

  const hasMore =
    sessionHasRunning(run.sessionId) || Boolean(nextQueuedRun(run.sessionId)) || activeSessionJobs.has(run.sessionId);
  if (!hasMore) {
    getDb()
      .prepare(`UPDATE agent_sessions SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`)
      .run(run.sessionId);
  }

  queueMicrotask(() => {
    void pumpSessionQueue(run.sessionId);
    void wakeQueuedSessions();
  });

  return getRun(runId, userId);
}

export async function deleteSession(sessionId: string, userId: number): Promise<void> {
  getSession(sessionId, userId);
  const db = getDb();
  const activeRuns = db
    .prepare(`SELECT id FROM agent_runs WHERE session_id = ? AND status IN ('queued','running')`)
    .all(sessionId) as { id: string }[];
  for (const row of activeRuns) {
    await cancelRun(row.id, userId);
  }
  db.prepare('DELETE FROM agent_sessions WHERE id = ?').run(sessionId);
  activeSessionJobs.delete(sessionId);
}
