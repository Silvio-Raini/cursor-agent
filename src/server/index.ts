import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import { env, isProd } from './config.js';
import { initDatabase } from './db.js';
import { toPublicError } from './util/errors.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerAgentRoutes } from './routes/agents.js';
import { registerShareRoutes } from './routes/shares.js';
import { resumeQueuesOnStartup } from './services/agents.js';

async function main(): Promise<void> {
  initDatabase();
  resumeQueuesOnStartup();

  const app = Fastify({
    logger: { level: isProd ? 'info' : 'debug' },
    trustProxy: env.TRUST_PROXY,
    bodyLimit: 1_048_576,
  });

  if (isProd && env.PUBLIC_URL.startsWith('https://')) {
    const publicOrigin = new URL(env.PUBLIC_URL).origin;
    app.addHook('onRequest', async (req, reply) => {
      const proto = req.headers['x-forwarded-proto'];
      if (proto && proto !== 'https') {
        return reply.redirect(`${publicOrigin}${req.url}`, 301);
      }
    });
  }

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  await app.register(cookie);
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  app.setErrorHandler((err, req, reply) => {
    const pub = toPublicError(err);
    if (pub.statusCode >= 500) req.log.error({ err }, 'error');
    reply.status(pub.statusCode).send(pub.body);
  });

  app.get('/api/health', async () => ({ success: true, data: { status: 'ok' } }));

  await registerAuthRoutes(app);
  await registerSettingsRoutes(app);
  await registerAgentRoutes(app);
  await registerShareRoutes(app);

  if (fs.existsSync(env.FRONTEND_DIST)) {
    await app.register(fastifyStatic, { root: env.FRONTEND_DIST, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Nicht gefunden.' } });
      }
      return reply.sendFile('index.html');
    });
  }

  await app.listen({ host: env.HOST, port: env.PORT });
  app.log.info(`Cursor Agent on http://${env.HOST}:${env.PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
