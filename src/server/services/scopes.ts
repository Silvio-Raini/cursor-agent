import fs from 'node:fs';
import path from 'node:path';
import { workspaceRoots, env } from '../config.js';
import { AppError } from '../util/errors.js';

export function assertAllowedCwd(cwdInput: string): string {
  const cwd = path.resolve(cwdInput);
  if (!path.isAbsolute(cwd)) {
    throw new AppError('VALIDATION_ERROR', 'Pfad muss absolut sein.', 400);
  }
  if (!fs.existsSync(cwd)) {
    throw new AppError('VALIDATION_ERROR', `Verzeichnis existiert nicht: ${cwd}`, 400);
  }
  if (env.AGENT_ALLOW_ANY_PATH) return cwd;

  const roots = workspaceRoots().map((r) => path.resolve(r));
  if (roots.length === 0) {
    throw new AppError(
      'CONFIG_ERROR',
      'Keine erlaubten Projekt-Pfade konfiguriert. Setze WORKSPACES oder AGENT_ALLOW_ANY_PATH=true.',
      503,
    );
  }
  const allowed = roots.some((root) => cwd === root || cwd.startsWith(`${root}${path.sep}`));
  if (!allowed) {
    throw new AppError(
      'FORBIDDEN',
      `Pfad nicht erlaubt. Konfiguriere WORKSPACES oder AGENT_ALLOW_ANY_PATH=true.`,
      403,
    );
  }
  if (cwd.includes(`${path.sep}node_modules${path.sep}`) || cwd.endsWith(`${path.sep}node_modules`)) {
    throw new AppError('FORBIDDEN', 'node_modules ist nicht erlaubt.', 403);
  }
  return cwd;
}

export function agentsMeta() {
  return {
    allowAnyPath: env.AGENT_ALLOW_ANY_PATH,
    hasWorkspaceAllowlist: workspaceRoots().length > 0,
    defaultModel: env.AGENT_DEFAULT_MODEL,
    maxConcurrent: env.AGENT_MAX_CONCURRENT,
    models: [
      { id: 'composer-2.5', label: 'Composer 2.5' },
      { id: 'auto', label: 'Auto' },
    ],
  };
}
