import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { DevShell } from '../components/DevShell';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

type Settings = {
  hasApiKey: boolean;
  apiKeyMasked: string;
  defaultModel: string;
  allowAnyPath: boolean;
  hasWorkspaceAllowlist: boolean;
  publicUrl: string;
};

type UpdateStatus = {
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

export function SettingsPage() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [updateMsg, setUpdateMsg] = useState('');
  const [updateBusy, setUpdateBusy] = useState(false);
  const [showLog, setShowLog] = useState(false);

  const loadUpdate = useCallback(async (fetchRemote = false) => {
    const data = await api<UpdateStatus>(
      `/api/settings/update${fetchRemote ? '?fetch=1' : ''}`,
    );
    setUpdate(data);
    return data;
  }, []);

  useEffect(() => {
    void api<Settings>('/api/settings').then(setSettings);
  }, []);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    void loadUpdate(false).catch((err) => {
      setUpdateMsg(err instanceof Error ? err.message : 'Update-Status nicht ladbar');
    });
  }, [user?.role, loadUpdate]);

  useEffect(() => {
    if (!update?.updating) return;
    const t = setInterval(() => {
      void loadUpdate(false)
        .then((data) => {
          if (!data.updating && data.lastStatus === 'ok') {
            setUpdateMsg('Update fertig — Seite neu laden.');
          } else if (!data.updating && data.lastStatus === 'failed') {
            setUpdateMsg('Update fehlgeschlagen — Log prüfen.');
            setShowLog(true);
          } else if (!data.updating && data.lastStatus === 'uptodate') {
            setUpdateMsg('Bereits auf dem neuesten Stand.');
          }
        })
        .catch(() => {
          // Während Restart kurz offline — weiter pollen
        });
    }, 2500);
    return () => clearInterval(t);
  }, [update?.updating, loadUpdate]);

  if (user?.role !== 'admin') {
    return (
      <DevShell title="Cursor Agent" subtitle="Einstellungen">
        <div className="panel settings-panel">
          <p>Kein Zugriff.</p>
          <Link className="tools-link" to="/">← Zurück</Link>
        </div>
      </DevShell>
    );
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    try {
      const data = await api<Settings>('/api/settings/api-key', {
        method: 'PUT',
        json: { apiKey },
      });
      setSettings(data);
      setApiKey('');
      setMsg('API-Key gespeichert.');
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Fehler');
    } finally {
      setBusy(false);
    }
  }

  async function checkUpdates() {
    setUpdateBusy(true);
    setUpdateMsg('');
    try {
      const data = await loadUpdate(true);
      if (data.updateAvailable) {
        setUpdateMsg(`${data.behind} Commit(s) verfügbar.`);
      } else if (data.dirty) {
        setUpdateMsg('Lokale Änderungen an Dateien — Update blockiert.');
      } else {
        setUpdateMsg('Bereits aktuell.');
      }
    } catch (err) {
      setUpdateMsg(err instanceof Error ? err.message : 'Fehler');
    } finally {
      setUpdateBusy(false);
    }
  }

  async function applyUpdate() {
    if (!update?.updateAvailable) return;
    if (update.dirty) {
      setUpdateMsg('Zuerst lokale Git-Änderungen bereinigen.');
      return;
    }
    const ok = confirm(
      'App jetzt aus Git aktualisieren?\n\n' +
        'Es wird origin/' +
        (update.branch || 'main') +
        ' geholt, gebaut und der Service neu gestartet.\n' +
        '.env und Daten bleiben erhalten.',
    );
    if (!ok) return;
    setUpdateBusy(true);
    setUpdateMsg('');
    try {
      const res = await api<{ started: boolean; message: string }>('/api/settings/update', {
        method: 'POST',
        json: {},
      });
      setUpdateMsg(res.message);
      setShowLog(true);
      await loadUpdate(false);
    } catch (err) {
      setUpdateMsg(err instanceof Error ? err.message : 'Fehler');
    } finally {
      setUpdateBusy(false);
    }
  }

  return (
    <DevShell
      title="Cursor Agent"
      subtitle="Einstellungen"
      actions={
        <Link className="tools-link" to="/">← Workspace</Link>
      }
    >
      <div className="panel settings-panel">
        <h1>API & Konfiguration</h1>
        <p className="hint">Cursor API-Key von cursor.com/dashboard/integrations</p>

        <dl className="settings-dl">
          <dt>Status</dt>
          <dd>{settings?.hasApiKey ? `Konfiguriert (${settings.apiKeyMasked})` : 'Nicht gesetzt'}</dd>
          <dt>Pfad-Policy</dt>
          <dd>
            {settings?.allowAnyPath
              ? 'Beliebige Pfade erlaubt'
              : settings?.hasWorkspaceAllowlist
                ? 'Allowlist (WORKSPACES)'
                : 'Nicht konfiguriert'}
          </dd>
          <dt>Modell</dt>
          <dd>{settings?.defaultModel}</dd>
        </dl>

        <form onSubmit={save}>
          <label>
            Neuer API-Key
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="cursor_…"
              autoComplete="off"
            />
          </label>
          {msg && <p className={msg.includes('gespeichert') ? 'form-ok' : 'form-error'}>{msg}</p>}
          <button type="submit" className="tool-btn primary" disabled={busy || apiKey.length < 10}>
            Speichern
          </button>
        </form>

        <section className="install-hint update-section">
          <h2>Update aus Git</h2>
          {!update?.enabled ? (
            <p className="hint">Updates sind deaktiviert (UPDATE_FROM_GIT=false).</p>
          ) : (
            <>
              <dl className="settings-dl">
                <dt>Branch</dt>
                <dd>
                  <code>{update.branch}</code>
                  {update.remote && (() => {
                    const href = update.remote
                      .replace(/^git@github\.com:/, 'https://github.com/')
                      .replace(/\.git$/, '');
                    return (
                      <>
                        {' · '}
                        <a className="tools-link" href={href} target="_blank" rel="noreferrer">
                          Repo
                        </a>
                      </>
                    );
                  })()}
                </dd>
                <dt>Installiert</dt>
                <dd>
                  {update.currentShort ? (
                    <>
                      <code>{update.currentShort}</code>
                      {update.currentMessage ? ` — ${update.currentMessage}` : ''}
                    </>
                  ) : (
                    '—'
                  )}
                </dd>
                <dt>Remote</dt>
                <dd>
                  {update.remoteShort ? (
                    <>
                      <code>{update.remoteShort}</code>
                      {update.remoteMessage ? ` — ${update.remoteMessage}` : ''}
                      {update.behind > 0 ? ` · ${update.behind} hinterher` : ''}
                      {update.ahead > 0 ? ` · ${update.ahead} voraus` : ''}
                    </>
                  ) : (
                    'Noch nicht geprüft'
                  )}
                </dd>
                <dt>Status</dt>
                <dd>
                  {update.updating
                    ? 'Update läuft…'
                    : update.dirty
                      ? 'Lokale Änderungen'
                      : update.updateAvailable
                        ? 'Update verfügbar'
                        : update.remoteSha
                          ? 'Aktuell'
                          : 'Unbekannt'}
                </dd>
              </dl>

              <div className="update-actions">
                <button
                  type="button"
                  className="tool-btn"
                  disabled={updateBusy || update.updating}
                  onClick={() => void checkUpdates()}
                >
                  {updateBusy && !update.updating ? 'Prüfe…' : 'Auf Updates prüfen'}
                </button>
                <button
                  type="button"
                  className="tool-btn primary"
                  disabled={
                    updateBusy ||
                    update.updating ||
                    !update.updateAvailable ||
                    update.dirty
                  }
                  onClick={() => void applyUpdate()}
                >
                  {update.updating ? 'Aktualisiere…' : 'Jetzt aktualisieren'}
                </button>
                <button
                  type="button"
                  className="tool-btn"
                  onClick={() => setShowLog((v) => !v)}
                >
                  {showLog ? 'Log ausblenden' : 'Log anzeigen'}
                </button>
              </div>

              {updateMsg && (
                <p className={updateMsg.toLowerCase().includes('fehl') ? 'form-error' : 'form-ok'}>
                  {updateMsg}
                </p>
              )}

              {showLog && update.logTail && (
                <pre className="update-log">{update.logTail}</pre>
              )}

              <p className="hint update-footnote">
                Holt <code>origin/{update.branch}</code>, führt <code>npm install</code> + Build aus und
                startet den Service neu. <code>.env</code> und die Datenbank in <code>data/</code> bleiben
                erhalten; vor dem Update wird ein DB-Backup angelegt. Schema-Änderungen laufen beim
                Neustart automatisch als Migrationen.
              </p>
            </>
          )}
        </section>

        <section className="install-hint">
          <h2>Self-Hosted</h2>
          <pre>{`git clone https://github.com/Silvio-Raini/cursor-agent
cd cursor-agent && npm install
cp .env.example .env && npm run build && npm start`}</pre>
        </section>
      </div>
    </DevShell>
  );
}
