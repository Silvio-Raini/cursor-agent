#!/usr/bin/env node
/**
 * Cursor Agent App im Server-Panel registrieren (nicht im öffentlichen Portal).
 */
import { initDatabase } from '../../../server-panel/backend/dist/database/db.js';
import { createApp, getApp, updateApp } from '../../../server-panel/backend/dist/services/apps/apps.js';
import { createDomain, getDomain, updateDomain } from '../../../server-panel/backend/dist/services/domains/domains.js';

const PORT = 3450;
const APP = {
  slug: 'cursor',
  name: 'Cursor Agent',
  type: 'node',
  sourcePath: '/opt/apps/cursor',
  entrypoint: '/opt/apps/cursor/dist/server/index.js',
  port: PORT,
  domain: 'cursor.codigoworks.com',
  description: 'Standalone Cursor Agent UI — lokale Agents via @cursor/sdk',
  privateProject: false,
  autoStart: true,
  notes: 'Eigenständige App, nicht im Portal apps.heimtech.cloud',
};

async function upsertApp() {
  try {
    return await createApp(APP);
  } catch (err) {
    if (err?.code === 'APP_EXISTS') return updateApp(APP.slug, APP);
    throw err;
  }
}

async function upsertDomain() {
  try {
    return await createDomain({
      domain: APP.domain,
      type: 'proxy',
      target: String(PORT),
      autoSsl: true,
      enabled: true,
      notes: 'Cursor Agent standalone app',
    });
  } catch (err) {
    if (err?.code === 'DOMAIN_EXISTS') {
      const existing = getDomain(APP.domain);
      return updateDomain(existing.id, { type: 'proxy', target: String(PORT), enabled: true });
    }
    throw err;
  }
}

async function main() {
  await initDatabase();
  const app = await upsertApp();
  await upsertDomain();
  console.log(`[ok] ${APP.slug} → https://${APP.domain}/ (port ${PORT})`);
  console.log(`Panel app id: ${app.id}, privateProject: ${app.privateProject}`);
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
