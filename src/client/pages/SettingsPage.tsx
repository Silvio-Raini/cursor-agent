import { useEffect, useState, type FormEvent } from 'react';
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

export function SettingsPage() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<Settings>('/api/settings').then(setSettings);
  }, []);

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
