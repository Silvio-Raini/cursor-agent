import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { getDb, type UserRow } from './db.js';
import { env } from './config.js';
import { AppError } from './util/errors.js';

const COOKIE = 'cursor_session';

export type PublicUser = { id: number; username: string; role: 'admin' | 'user' };

export function publicUser(u: UserRow): PublicUser {
  return { id: u.id, username: u.username, role: u.role };
}

export async function authenticate(username: string, password: string): Promise<UserRow | null> {
  const row = getDb()
    .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE AND username = ?')
    .get(username, username) as UserRow | undefined;
  if (!row) return null;
  const ok = await argon2.verify(row.password_hash, password);
  return ok ? row : null;
}

export async function createSession(reply: FastifyReply, user: UserRow): Promise<string> {
  const id = nanoid(32);
  const csrf = nanoid(32);
  const expires = new Date(Date.now() + env.SESSION_MAX_AGE * 1000).toISOString();
  getDb().prepare('INSERT INTO sessions (id, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)').run(
    id,
    user.id,
    csrf,
    expires,
  );
  reply.setCookie(COOKIE, id, {
    path: '/',
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    maxAge: env.SESSION_MAX_AGE,
  });
  return csrf;
}

export function clearSession(reply: FastifyReply, sessionId?: string): void {
  if (sessionId) getDb().prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  reply.clearCookie(COOKIE, { path: '/' });
}

export function getAuth(req: FastifyRequest): { user: UserRow; sessionId: string; csrf: string } | null {
  const sid = req.cookies[COOKIE];
  if (!sid) return null;
  const row = getDb()
    .prepare(
      `SELECT s.id AS sid, s.csrf_token, s.expires_at, u.*
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    )
    .get(sid) as
    | (UserRow & { sid: string; csrf_token: string; expires_at: string })
    | undefined;
  if (!row || new Date(row.expires_at) < new Date()) return null;
  return {
    user: row,
    sessionId: row.sid,
    csrf: row.csrf_token,
  };
}

export function requireUser(req: FastifyRequest) {
  const auth = getAuth(req);
  if (!auth) throw new AppError('UNAUTHORIZED', 'Anmeldung erforderlich.', 401);
  return auth;
}

export function requireAdmin(req: FastifyRequest) {
  const auth = requireUser(req);
  if (auth.user.role !== 'admin') throw new AppError('FORBIDDEN', 'Admin erforderlich.', 403);
  return auth;
}

export function requireCsrf(req: FastifyRequest, auth: { csrf: string }): void {
  const token = req.headers['x-csrf-token'] as string | undefined;
  if (!token || token.length !== auth.csrf.length) {
    throw new AppError('CSRF_FAILED', 'CSRF-Token ungültig.', 403);
  }
  if (!timingSafeEqual(Buffer.from(token), Buffer.from(auth.csrf))) {
    throw new AppError('CSRF_FAILED', 'CSRF-Token ungültig.', 403);
  }
}

export function maskApiKey(key: string): string {
  if (!key || key.length < 12) return key ? '••••' : '';
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}
