import { config as loadEnv } from 'dotenv';
import { z } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
loadEnv({ path: path.join(rootDir, '.env') });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(3450),
  TRUST_PROXY: z.string().optional().transform((v) => v !== 'false'),
  DATABASE_PATH: z.string().default(path.join(rootDir, 'data', 'cursor.db')),
  SESSION_SECRET: z.string().min(32),
  SESSION_MAX_AGE: z.coerce.number().int().positive().default(604_800),
  COOKIE_SECURE: z.string().optional().transform((v) => v !== 'false'),
  BOOTSTRAP_USERNAME: z.string().min(3).default('admin'),
  BOOTSTRAP_PASSWORD: z.string().min(8).default('ChangeMeNow!'),
  CURSOR_API_KEY: z.string().default(''),
  WORKSPACES: z.string().default(''),
  AGENT_MAX_CONCURRENT: z.coerce.number().int().positive().default(2),
  AGENT_MAX_RUN_MS: z.coerce.number().int().positive().default(7_200_000),
  AGENT_DEFAULT_MODEL: z.string().default('composer-2.5'),
  AGENT_ALLOW_ANY_PATH: z.string().optional().transform((v) => v === 'true'),
  PUBLIC_URL: z.string().url().default('https://cursor.codigoworks.com'),
  FRONTEND_DIST: z.string().default(path.join(rootDir, 'dist', 'client')),
  UPDATE_FROM_GIT: z.string().optional().transform((v) => v !== 'false'),
  UPDATE_BRANCH: z.string().default('main'),
  UPDATE_SERVICE: z.string().default('app-cursor'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid config:', parsed.error.flatten().fieldErrors);
  if (process.env.NODE_ENV !== 'test') process.exit(1);
  throw new Error('Invalid config');
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const appRoot = rootDir;

export function workspaceRoots(): string[] {
  return env.WORKSPACES.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
