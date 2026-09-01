import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireCsrf, requireUser } from '../auth.js';
import { AppError } from '../util/errors.js';
import { agentsMeta } from '../services/scopes.js';
import {
  cancelRun,
  createSession,
  deleteSession,
  getRun,
  getSession,
  listRunEvents,
  listRuns,
  listSessions,
  sendPrompt,
  subscribeRunEvents,
} from '../services/agents.js';
import { getSettingsPublic } from '../services/settings.js';
import { env } from '../config.js';

export async function registerAgentRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/agents/meta', async (req) => {
    requireUser(req);
    return { success: true, data: { ...agentsMeta(), settings: getSettingsPublic() } };
  });

  app.get('/api/agents/sessions', async (req) => {
    const auth = requireUser(req);
    return { success: true, data: listSessions(auth.user.id) };
  });

  app.get('/api/agents/sessions/:id', async (req) => {
    const auth = requireUser(req);
    const { id } = req.params as { id: string };
    return { success: true, data: { session: getSession(id, auth.user.id), runs: listRuns(id, auth.user.id) } };
  });

  app.post('/api/agents/sessions', async (req) => {
    const auth = requireUser(req);
    requireCsrf(req, auth);
    const schema = z.object({
      cwd: z.string().min(1).max(500),
      workspaceLabel: z.string().max(200).optional(),
      model: z.string().max(80).optional(),
      title: z.string().max(120).optional(),
      prompt: z.string().max(50_000).optional(),
    });
    const body = schema.safeParse(req.body);
    if (!body.success) throw new AppError('VALIDATION_ERROR', 'Ungültige Eingabe.', 400);
    return {
      success: true,
      data: await createSession({ ...body.data, userId: auth.user.id }),
    };
  });

  app.post('/api/agents/sessions/:id/send', {
    config: { rateLimit: { max: 15, timeWindow: 60_000 } },
  }, async (req) => {
    const auth = requireUser(req);
    requireCsrf(req, auth);
    const { id } = req.params as { id: string };
    const body = z.object({ prompt: z.string().min(1).max(50_000) }).safeParse(req.body);
    if (!body.success) throw new AppError('VALIDATION_ERROR', 'Ungültige Eingabe.', 400);
    return { success: true, data: await sendPrompt(id, body.data.prompt, auth.user.id) };
  });

  app.delete('/api/agents/sessions/:id', async (req) => {
    const auth = requireUser(req);
    requireCsrf(req, auth);
    const { id } = req.params as { id: string };
    await deleteSession(id, auth.user.id);
    return { success: true, data: { deleted: true } };
  });

  app.get('/api/agents/runs/:runId', async (req) => {
    const auth = requireUser(req);
    const { runId } = req.params as { runId: string };
    return { success: true, data: getRun(runId, auth.user.id) };
  });

  app.post('/api/agents/runs/:runId/cancel', async (req) => {
    const auth = requireUser(req);
    requireCsrf(req, auth);
    const { runId } = req.params as { runId: string };
    return { success: true, data: await cancelRun(runId, auth.user.id) };
  });

  app.get('/api/agents/runs/:runId/events', async (req) => {
    const auth = requireUser(req);
    const { runId } = req.params as { runId: string };
    return { success: true, data: listRunEvents(runId, auth.user.id) };
  });

  app.get('/api/agents/runs/:runId/stream', async (req, reply: FastifyReply) => {
    const auth = requireUser(req);
    const { runId } = req.params as { runId: string };
    getRun(runId, auth.user.id);

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (payload: unknown) => reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    for (const ev of listRunEvents(runId, auth.user.id)) {
      send({ type: ev.type, ...ev.payload, seq: ev.seq });
    }
    const unsub = subscribeRunEvents(runId, (ev) => send(ev));
    const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 15_000);
    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsub();
    });
  });
}
