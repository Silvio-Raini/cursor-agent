import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, clearSession, createSession, getAuth, publicUser, requireCsrf, requireUser } from '../auth.js';
import { AppError } from '../util/errors.js';

const loginSchema = z.object({
  username: z.string().min(2).max(80),
  password: z.string().min(1).max(200),
});

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/auth/me', async (req) => {
    const auth = getAuth(req);
    return { success: true, data: { user: auth ? publicUser(auth.user) : null, csrf: auth?.csrf || null } };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = loginSchema.safeParse(req.body);
    if (!body.success) throw new AppError('VALIDATION_ERROR', 'Ungültige Eingabe.', 400);
    const user = await authenticate(body.data.username, body.data.password);
    if (!user) throw new AppError('INVALID_LOGIN', 'Benutzername oder Passwort falsch.', 401);
    const csrf = await createSession(reply, user);
    return { success: true, data: { user: publicUser(user), csrf } };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const auth = getAuth(req);
    if (auth) requireCsrf(req, auth);
    clearSession(reply, auth?.sessionId);
    return { success: true, data: { ok: true } };
  });
}
