import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireCsrf, requireUser } from '../auth.js';
import { getSettingsPublic, setCursorApiKey } from '../services/settings.js';
import { getUpdateStatus, startUpdate } from '../services/update.js';
import { AppError } from '../util/errors.js';

export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings', async (req) => {
    requireUser(req);
    return { success: true, data: getSettingsPublic() };
  });

  app.put('/api/settings/api-key', async (req) => {
    const auth = requireAdmin(req);
    requireCsrf(req, auth);
    const body = z.object({ apiKey: z.string().min(10).max(500) }).safeParse(req.body);
    if (!body.success) throw new AppError('VALIDATION_ERROR', 'Ungültiger API-Key.', 400);
    setCursorApiKey(body.data.apiKey);
    return { success: true, data: getSettingsPublic() };
  });

  app.get('/api/settings/update', async (req) => {
    requireAdmin(req);
    const fetchRemote = (req.query as { fetch?: string }).fetch === '1';
    return { success: true, data: await getUpdateStatus(fetchRemote) };
  });

  app.post('/api/settings/update', {
    config: { rateLimit: { max: 3, timeWindow: 60_000 } },
  }, async (req) => {
    const auth = requireAdmin(req);
    requireCsrf(req, auth);
    return { success: true, data: startUpdate() };
  });
}
