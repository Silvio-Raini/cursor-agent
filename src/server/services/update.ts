import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { appRoot, env } from '../config.js';
import { AppError } from '../util/errors.js';

const execFileAsync = promisify(execFile);

const LOG_FILE = path.join(appRoot, 'data', 'update.log');
const LOCK_FILE = path.join(appRoot, 'data', 'update.lock');
const STATUS_FILE = path.join(appRoot, 'data', 'update.status');
const SCRIPT = path.join(appRoot, 'scripts', 'self-update.sh');

async function git(args: string[], opts?: { timeout?: number }): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: appRoot,
    timeout: opts?.timeout ?? 60_000,
    maxBuffer: 2_000_000,
  });
  return stdout.trim();
}

function readTail(file: string, maxChars = 4000): string {
  try {
    if (!fs.existsSync(file)) return '';
    const text = fs.readFileSync(file, 'utf8');
    return text.length > maxChars ? text.slice(-maxChars) : text;
  } catch {
    return '';
  }
}

function isUpdating(): boolean {
  try {
    if (!fs.existsSync(LOCK_FILE)) {
      // Status kann kurz auf running stehen bevor Lock da ist
      if (fs.existsSync(STATUS_FILE)) {
        const st = fs.readFileSync(STATUS_FILE, 'utf8').trim();
        if (st === 'running') {
          // älter als 30 Min = hängengeblieben
          const age = Date.now() - fs.statSync(STATUS_FILE).mtimeMs;
          return age < 30 * 60_000;
        }
      }
      return false;
    }
    const raw = fs.readFileSync(LOCK_FILE, 'utf8').trim();
    const pid = Number(raw);
    if (!Number.isFinite(pid) || pid <= 0) return true;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      fs.unlinkSync(LOCK_FILE);
      return false;
    }
  } catch {
    return false;
  }
}

export type UpdateStatus = {
  enabled: boolean;
  updating: boolean;
  branch: string;
  remote: string | null;
  currentSha: string | null;
  currentShort: string | null;
  currentMessage: string | null;
  remoteSha: string | null;
  remoteShort: string | null;
  remoteMessage: string | null;
  behind: number;
  ahead: number;
  dirty: boolean;
  updateAvailable: boolean;
  lastStatus: string | null;
  logTail: string;
};

export async function getUpdateStatus(fetchRemote = false): Promise<UpdateStatus> {
  const base: UpdateStatus = {
    enabled: env.UPDATE_FROM_GIT,
    updating: isUpdating(),
    branch: env.UPDATE_BRANCH,
    remote: null,
    currentSha: null,
    currentShort: null,
    currentMessage: null,
    remoteSha: null,
    remoteShort: null,
    remoteMessage: null,
    behind: 0,
    ahead: 0,
    dirty: false,
    updateAvailable: false,
    lastStatus: null,
    logTail: readTail(LOG_FILE),
  };

  try {
    if (fs.existsSync(STATUS_FILE)) {
      base.lastStatus = fs.readFileSync(STATUS_FILE, 'utf8').trim() || null;
    }
  } catch {
    /* ignore */
  }

  if (!env.UPDATE_FROM_GIT) return base;

  try {
    if (!fs.existsSync(path.join(appRoot, '.git'))) {
      throw new AppError('UPDATE_UNAVAILABLE', 'Kein Git-Repository gefunden.', 503);
    }

    base.remote = (await git(['remote', 'get-url', 'origin']).catch(() => '')) || null;
    base.currentSha = await git(['rev-parse', 'HEAD']);
    base.currentShort = base.currentSha.slice(0, 7);
    base.currentMessage = await git(['log', '-1', '--pretty=%s']);
    base.dirty = Boolean(await git(['status', '--porcelain', '--untracked-files=no']));

    if (fetchRemote) {
      await git(['fetch', '--prune', 'origin', env.UPDATE_BRANCH], { timeout: 120_000 });
    }

    const remoteRef = `origin/${env.UPDATE_BRANCH}`;
    try {
      base.remoteSha = await git(['rev-parse', remoteRef]);
      base.remoteShort = base.remoteSha.slice(0, 7);
      base.remoteMessage = await git(['log', '-1', '--pretty=%s', remoteRef]);
      const counts = await git(['rev-list', '--left-right', '--count', `HEAD...${remoteRef}`]);
      const [aheadStr, behindStr] = counts.split(/\s+/);
      base.ahead = Number(aheadStr) || 0;
      base.behind = Number(behindStr) || 0;
      base.updateAvailable = base.behind > 0;
    } catch {
      /* remote branch ggf. erst nach fetch */
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    const msg = err instanceof Error ? err.message : 'Git-Fehler';
    throw new AppError('UPDATE_STATUS_FAILED', msg, 500);
  }

  return base;
}

export function startUpdate(): { started: true; message: string } {
  if (!env.UPDATE_FROM_GIT) {
    throw new AppError('UPDATE_DISABLED', 'Updates aus Git sind deaktiviert.', 403);
  }
  if (!fs.existsSync(path.join(appRoot, '.git'))) {
    throw new AppError('UPDATE_UNAVAILABLE', 'Kein Git-Repository gefunden.', 503);
  }
  if (!fs.existsSync(SCRIPT)) {
    throw new AppError('UPDATE_UNAVAILABLE', 'Update-Skript fehlt.', 503);
  }
  if (isUpdating()) {
    throw new AppError('UPDATE_IN_PROGRESS', 'Update läuft bereits.', 409);
  }

  fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true });
  fs.writeFileSync(STATUS_FILE, 'running');

  const runEnv = {
    ...process.env,
    UPDATE_BRANCH: env.UPDATE_BRANCH,
    UPDATE_SERVICE: env.UPDATE_SERVICE,
  };

  let launched = false;
  try {
    const unit = `cursor-agent-update-${Date.now()}`;
    execFileSync(
      'systemd-run',
      [
        '--collect',
        `--unit=${unit}`,
        `--working-directory=${appRoot}`,
        '/bin/bash',
        SCRIPT,
      ],
      { env: runEnv, stdio: 'ignore', timeout: 15_000 },
    );
    launched = true;
  } catch {
    launched = false;
  }

  if (!launched) {
    const out = fs.openSync(LOG_FILE, 'a');
    const child = spawn('/bin/bash', [SCRIPT], {
      cwd: appRoot,
      detached: true,
      stdio: ['ignore', out, out],
      env: runEnv,
    });
    child.unref();
  }

  return {
    started: true,
    message: 'Update gestartet. Die App startet in Kürze neu — Seite danach neu laden.',
  };
}
