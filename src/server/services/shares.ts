import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config.js';
import { getDb } from '../db.js';
import { AppError } from '../util/errors.js';
import { subscribeRunEvents } from './agents.js';

const UNLOCK_MAX_AGE_SEC = 30 * 24 * 60 * 60;
const FAIL_LIMIT = 8;
const FAIL_LOCK_MS = 15 * 60 * 1000;

type ShareRow = {
  session_id: string;
  token: string;
  password_hash: string;
  created_by_user_id: number;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
};

export type ShareStatus = {
  active: boolean;
  expired: boolean;
  token: string | null;
  url: string | null;
  createdAt: string | null;
  expiresAt: string | null;
};

export type PublicRun = {
  id: string;
  prompt: string;
  status: string;
  errorMessage: string | null;
};

export type PublicChat = {
  title: string;
  workspaceLabel: string | null;
  model: string;
  status: string;
  runs: PublicRun[];
};

type FailState = { n: number; until: number };
const failures = new Map<string, FailState>();

function cookieName(token: string): string {
  return `su_${token.slice(0, 12)}`;
}

function shareUrl(token: string): string {
  return `${env.PUBLIC_URL.replace(/\/$/, '')}/s/${token}`;
}

export function isShareExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  const ts = new Date(expiresAt).getTime();
  return !Number.isFinite(ts) || ts <= Date.now();
}

function emptyStatus(): ShareStatus {
  return { active: false, expired: false, token: null, url: null, createdAt: null, expiresAt: null };
}

function toStatus(row: ShareRow | undefined): ShareStatus {
  if (!row) return emptyStatus();
  const expired = isShareExpired(row.expires_at);
  return {
    active: !expired,
    expired,
    token: row.token,
    url: shareUrl(row.token),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

function requireOwnedSession(sessionId: string, userId: number): void {
  const row = getDb()
    .prepare('SELECT created_by_user_id FROM agent_sessions WHERE id = ?')
    .get(sessionId) as { created_by_user_id: number } | undefined;
  if (!row) throw new AppError('NOT_FOUND', 'Session nicht gefunden.', 404);
  if (row.created_by_user_id !== userId) throw new AppError('FORBIDDEN', 'Kein Zugriff.', 403);
}

function getShareBySession(sessionId: string): ShareRow | undefined {
  return getDb().prepare('SELECT * FROM chat_shares WHERE session_id = ?').get(sessionId) as ShareRow | undefined;
}

function getShareByToken(token: string): ShareRow | undefined {
  return getDb().prepare('SELECT * FROM chat_shares WHERE token = ?').get(token) as ShareRow | undefined;
}

function assertUsableShare(token: string): ShareRow {
  const row = getShareByToken(token);
  if (!row) throw new AppError('NOT_FOUND', 'Link ungültig.', 404);
  if (isShareExpired(row.expires_at)) {
    throw new AppError('SHARE_EXPIRED', 'Diese Freigabe ist abgelaufen.', 410);
  }
  return row;
}

function expiresFromDays(days: number | null): string | null {
  if (days == null) return null;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function clearUnlocks(sessionId: string): void {
  getDb().prepare('DELETE FROM share_unlocks WHERE session_id = ?').run(sessionId);
}

export function getShareStatus(sessionId: string, userId: number): ShareStatus {
  requireOwnedSession(sessionId, userId);
  return toStatus(getShareBySession(sessionId));
}

export async function upsertShare(
  sessionId: string,
  userId: number,
  input: { password?: string; expiresInDays?: number | null; rotateLink?: boolean },
): Promise<ShareStatus> {
  requireOwnedSession(sessionId, userId);
  const existing = getShareBySession(sessionId);

  if (!existing) {
    if (!input.password) throw new AppError('VALIDATION_ERROR', 'Passwort erforderlich.', 400);
    const hash = await argon2.hash(input.password, { type: argon2.argon2id });
    const token = nanoid(32);
    const expiresAt = expiresFromDays(input.expiresInDays ?? null);
    getDb()
      .prepare(
        `INSERT INTO chat_shares (session_id, token, password_hash, created_by_user_id, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(sessionId, token, hash, userId, expiresAt);
    return toStatus(getShareBySession(sessionId));
  }

  let token = existing.token;
  let hash = existing.password_hash;
  let expiresAt = existing.expires_at;
  let changed = false;

  if (input.password) {
    hash = await argon2.hash(input.password, { type: argon2.argon2id });
    changed = true;
  }
  if (input.rotateLink) {
    token = nanoid(32);
    changed = true;
  }
  if (input.expiresInDays !== undefined) {
    const next = expiresFromDays(input.expiresInDays);
    if (next !== expiresAt) {
      expiresAt = next;
      changed = true;
    }
  }

  if (!changed) return toStatus(existing);

  getDb()
    .prepare(
      `UPDATE chat_shares
       SET token = ?, password_hash = ?, expires_at = ?, updated_at = datetime('now')
       WHERE session_id = ?`,
    )
    .run(token, hash, expiresAt, sessionId);
  clearUnlocks(sessionId);
  return toStatus(getShareBySession(sessionId));
}

export function revokeShare(sessionId: string, userId: number): void {
  requireOwnedSession(sessionId, userId);
  getDb().prepare('DELETE FROM chat_shares WHERE session_id = ?').run(sessionId);
}

function failKey(token: string, ip: string): string {
  return `${token}:${ip}`;
}

function assertNotLockedOut(token: string, ip: string): void {
  const state = failures.get(failKey(token, ip));
  if (state && state.until > Date.now()) {
    throw new AppError('RATE_LIMITED', 'Zu viele Versuche. Bitte kurz warten.', 429);
  }
}

function noteFailure(token: string, ip: string): void {
  const key = failKey(token, ip);
  const state = failures.get(key) || { n: 0, until: 0 };
  if (state.until && state.until <= Date.now()) {
    state.n = 0;
    state.until = 0;
  }
  state.n += 1;
  if (state.n >= FAIL_LIMIT) {
    state.until = Date.now() + FAIL_LOCK_MS;
    state.n = 0;
  }
  failures.set(key, state);
}

function noteSuccess(token: string, ip: string): void {
  failures.delete(failKey(token, ip));
}

function purgeUnlock(id: string): void {
  getDb().prepare('DELETE FROM share_unlocks WHERE id = ? OR expires_at <= ?').run(id, new Date().toISOString());
}

function validUnlock(token: string, unlockId: string | undefined, sessionId: string): boolean {
  if (!unlockId) return false;
  const row = getDb()
    .prepare('SELECT id, session_id, expires_at FROM share_unlocks WHERE id = ?')
    .get(unlockId) as { id: string; session_id: string; expires_at: string } | undefined;
  if (!row || row.session_id !== sessionId) return false;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    purgeUnlock(row.id);
    return false;
  }
  return Boolean(token);
}

export function loadPublicChat(sessionId: string): PublicChat {
  const session = getDb()
    .prepare('SELECT title, workspace_label, model, status FROM agent_sessions WHERE id = ?')
    .get(sessionId) as
    | { title: string; workspace_label: string | null; model: string; status: string }
    | undefined;
  if (!session) throw new AppError('NOT_FOUND', 'Chat nicht gefunden.', 404);
  const runs = getDb()
    .prepare(
      `SELECT id, prompt, status, error_message
       FROM agent_runs WHERE session_id = ? ORDER BY started_at DESC`,
    )
    .all(sessionId) as Array<{ id: string; prompt: string; status: string; error_message: string | null }>;
  return {
    title: session.title,
    workspaceLabel: session.workspace_label,
    model: session.model,
    status: session.status,
    runs: runs.map((r) => ({
      id: r.id,
      prompt: r.prompt,
      status: r.status,
      errorMessage: r.error_message,
    })),
  };
}

export function readShare(req: FastifyRequest, token: string): { locked: true } | { locked: false; chat: PublicChat } {
  const share = assertUsableShare(token);
  const unlocked = validUnlock(token, req.cookies[cookieName(token)], share.session_id);
  if (!unlocked) return { locked: true };
  return { locked: false, chat: loadPublicChat(share.session_id) };
}

export async function unlockShare(
  req: FastifyRequest,
  reply: FastifyReply,
  token: string,
  password: string,
): Promise<PublicChat> {
  const ip = req.ip || 'unknown';
  assertNotLockedOut(token, ip);
  const share = assertUsableShare(token);
  const ok = await argon2.verify(share.password_hash, password).catch(() => false);
  if (!ok) {
    noteFailure(token, ip);
    throw new AppError('SHARE_DENIED', 'Passwort falsch.', 401);
  }
  noteSuccess(token, ip);

  const unlockId = nanoid(32);
  const shareEnd = share.expires_at ? new Date(share.expires_at).getTime() : Number.POSITIVE_INFINITY;
  const expMs = Math.min(Date.now() + UNLOCK_MAX_AGE_SEC * 1000, shareEnd);
  const expiresAt = new Date(expMs).toISOString();
  const maxAge = Math.max(60, Math.floor((expMs - Date.now()) / 1000));

  getDb()
    .prepare('INSERT INTO share_unlocks (id, session_id, expires_at) VALUES (?, ?, ?)')
    .run(unlockId, share.session_id, expiresAt);

  reply.setCookie(cookieName(token), unlockId, {
    path: '/',
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    maxAge,
  });

  return loadPublicChat(share.session_id);
}

export function requireUnlockedShare(req: FastifyRequest, token: string): ShareRow {
  const share = assertUsableShare(token);
  if (!validUnlock(token, req.cookies[cookieName(token)], share.session_id)) {
    throw new AppError('SHARE_LOCKED', 'Passwort erforderlich.', 401);
  }
  return share;
}

export function listShareRunEvents(sessionId: string, runId: string) {
  const run = getDb().prepare('SELECT session_id FROM agent_runs WHERE id = ?').get(runId) as
    | { session_id: string }
    | undefined;
  if (!run || run.session_id !== sessionId) throw new AppError('NOT_FOUND', 'Run nicht gefunden.', 404);
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

export function subscribeShareRun(sessionId: string, runId: string, listener: (ev: unknown) => void) {
  const run = getDb().prepare('SELECT session_id FROM agent_runs WHERE id = ?').get(runId) as
    | { session_id: string }
    | undefined;
  if (!run || run.session_id !== sessionId) throw new AppError('NOT_FOUND', 'Run nicht gefunden.', 404);
  return subscribeRunEvents(runId, listener);
}
