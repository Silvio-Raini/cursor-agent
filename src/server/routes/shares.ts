import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireCsrf, requireUser } from '../auth.js';
import { AppError } from '../util/errors.js';
import {
  cancelSharedRun,
  getShareStatus,
  listShareRunEvents,
  readShare,
  requireUnlockedShare,
  revokeShare,
  sendSharedPrompt,
  subscribeShareRun,
  unlockShare,
  upsertShare,
} from '../services/shares.js';

const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

function parseToken(raw: string): string {
  const token = tokenSchema.safeParse(raw);
  if (!token.success) throw new AppError('NOT_FOUND', 'Link ungültig.', 404);
  return token.data;
}

export async function registerShareRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/agents/sessions/:id/share', async (req) => {
    const auth = requireUser(req);
    const { id } = req.params as { id: string };
    return { success: true, data: getShareStatus(id, auth.user.id) };
  });

  app.put('/api/agents/sessions/:id/share', async (req) => {
    const auth = requireUser(req);
    requireCsrf(req, auth);
    const { id } = req.params as { id: string };
    const schema = z.object({
      password: z.string().min(4).max(128).optional(),
      expiresInDays: z.union([z.literal(1), z.literal(7), z.literal(30), z.null()]).optional(),
      rotateLink: z.boolean().optional(),
      canWrite: z.boolean().optional(),
    });
    const body = schema.safeParse(req.body);
    if (!body.success) throw new AppError('VALIDATION_ERROR', 'Ungültige Eingabe. Passwort mindestens 4 Zeichen.', 400);
    return { success: true, data: await upsertShare(id, auth.user.id, body.data) };
  });

  app.delete('/api/agents/sessions/:id/share', async (req) => {
    const auth = requireUser(req);
    requireCsrf(req, auth);
    const { id } = req.params as { id: string };
    revokeShare(id, auth.user.id);
    return { success: true, data: { revoked: true } };
  });

  app.get('/api/share/:token', async (req) => {
    const { token } = req.params as { token: string };
    return { success: true, data: readShare(req, parseToken(token)) };
  });

  app.post('/api/share/:token/unlock', {
    config: { rateLimit: { max: 8, timeWindow: 60_000 } },
  }, async (req, reply) => {
    const { token } = req.params as { token: string };
    const body = z.object({ password: z.string().min(1).max(128) }).safeParse(req.body);
    if (!body.success) throw new AppError('VALIDATION_ERROR', 'Passwort fehlt.', 400);
    const chat = await unlockShare(req, reply, parseToken(token), body.data.password);
    return { success: true, data: { locked: false, chat } };
  });

  app.post('/api/share/:token/send', {
    config: { rateLimit: { max: 15, timeWindow: 60_000 } },
  }, async (req) => {
    const { token } = req.params as { token: string };
    const body = z.object({ prompt: z.string().min(1).max(50_000) }).safeParse(req.body);
    if (!body.success) throw new AppError('VALIDATION_ERROR', 'Ungültige Eingabe.', 400);
    const chat = await sendSharedPrompt(req, parseToken(token), body.data.prompt);
    return { success: true, data: { locked: false, chat } };
  });

  app.post('/api/share/:token/runs/:runId/cancel', async (req) => {
    const { token, runId } = req.params as { token: string; runId: string };
    const chat = await cancelSharedRun(req, parseToken(token), runId);
    return { success: true, data: { locked: false, chat } };
  });

  app.get('/api/share/:token/runs/:runId/events', async (req) => {
    const { token, runId } = req.params as { token: string; runId: string };
    const share = requireUnlockedShare(req, parseToken(token));
    return { success: true, data: listShareRunEvents(share.session_id, runId) };
  });

  app.get('/api/share/:token/runs/:runId/stream', async (req, reply: FastifyReply) => {
    const { token, runId } = req.params as { token: string; runId: string };
    const share = requireUnlockedShare(req, parseToken(token));
    const events = listShareRunEvents(share.session_id, runId);

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (payload: unknown) => reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    for (const ev of events) send({ type: ev.type, ...ev.payload, seq: ev.seq });
    const unsub = subscribeShareRun(share.session_id, runId, (ev) => send(ev));
    const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 15_000);
    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsub();
    });
  });
}
