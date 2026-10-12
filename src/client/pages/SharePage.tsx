import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { DevShell } from '../components/DevShell';
import { RunThread } from '../components/RunThread';
import { ThemeToggle } from '../components/ThemeToggle';
import { api } from '../lib/api';

type Run = {
  id: string;
  prompt: string;
  status: string;
  errorMessage: string | null;
};

type PublicChat = {
  title: string;
  workspaceLabel: string | null;
  model: string;
  status: string;
  runs: Run[];
};

type ShareView = { locked: true } | { locked: false; chat: PublicChat };

export function SharePage() {
  const { token = '' } = useParams();
  const [phase, setPhase] = useState<'loading' | 'invalid' | 'expired' | 'locked' | 'open'>('loading');
  const [chat, setChat] = useState<PublicChat | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const apply = useCallback((data: ShareView) => {
    if (data.locked) {
      setChat(null);
      setPhase('locked');
      return;
    }
    setChat(data.chat);
    setPhase('open');
  }, []);

  const load = useCallback(async (quiet = false) => {
    try {
      const data = await api<ShareView>(`/api/share/${token}`);
      apply(data);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (quiet && code !== 'SHARE_EXPIRED' && code !== 'NOT_FOUND') return;
      setChat(null);
      setPhase(code === 'SHARE_EXPIRED' ? 'expired' : 'invalid');
    }
  }, [apply, token]);

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    if (phase !== 'open') return;
    const t = setInterval(() => void load(true), 5000);
    return () => clearInterval(t);
  }, [phase, load]);

  async function unlock(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await api<ShareView>(`/api/share/${token}/unlock`, {
        method: 'POST',
        json: { password },
      });
      setPassword('');
      apply(data);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'SHARE_EXPIRED') setPhase('expired');
      else if (code === 'NOT_FOUND') setPhase('invalid');
      else setError(err instanceof Error ? err.message : 'Zugriff verweigert.');
    } finally {
      setBusy(false);
    }
  }

  if (phase === 'loading') return <div className="loading-screen">Laden…</div>;

  if (phase === 'invalid' || phase === 'expired') {
    return (
      <div className="page login-page">
        <div className="login-card panel">
          <div className="login-top">
            <div className="brand-group">
              <span className="brand-mark" aria-hidden="true" />
              <div>
                <p className="brand-title">Geteilter Chat</p>
                <p className="brand-sub">Cursor Agent</p>
              </div>
            </div>
            <ThemeToggle />
          </div>
          <p className="form-error">
            {phase === 'expired' ? 'Diese Freigabe ist abgelaufen.' : 'Dieser Link ist ungültig.'}
          </p>
        </div>
      </div>
    );
  }

  if (phase === 'locked' || !chat) {
    return (
      <div className="page login-page">
        <div className="login-card panel">
          <div className="login-top">
            <div className="brand-group">
              <span className="brand-mark" aria-hidden="true" />
              <div>
                <p className="brand-title">Geteilter Chat</p>
                <p className="brand-sub">Passwort erforderlich</p>
              </div>
            </div>
            <ThemeToggle />
          </div>
          <form onSubmit={(e) => void unlock(e)} className="login-form">
            <label>
              Passwort
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                autoFocus
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <button type="submit" className="tool-btn primary btn-block" disabled={busy || !password}>
              {busy ? 'Prüfen…' : 'Chat öffnen'}
            </button>
          </form>
          <p className="login-foot">Nur lesen. Der Chat bleibt auf diesem Server.</p>
        </div>
      </div>
    );
  }

  const liveRunId = chat.runs.find((r) => r.status === 'running')?.id || null;

  return (
    <DevShell title={chat.title} subtitle="Geteilter Chat · nur lesen">
      <section className="chat-shell panel share-shell">
        <div className="chat-shell-head">
          <div className="chat-shell-title">
            <h2>{chat.title}</h2>
            <div className="chat-shell-meta">
              {chat.workspaceLabel && <span className="cwd-badge">{chat.workspaceLabel}</span>}
              <span className="pill">nur lesen</span>
              <span className={`pill status-${liveRunId ? 'running' : chat.status}`}>
                {liveRunId ? 'läuft' : chat.status === 'idle' || chat.status === 'finished' ? 'bereit' : chat.status}
              </span>
            </div>
          </div>
        </div>
        <div className="chat-panel">
          {chat.runs.length === 0 ? (
            <div className="empty-state">
              <p>Dieser Chat hat noch keine Nachrichten.</p>
            </div>
          ) : (
            chat.runs
              .slice()
              .reverse()
              .map((run, i) => (
                <RunThread
                  key={run.id}
                  run={run}
                  isFirst={i === 0}
                  live={run.id === liveRunId && run.status === 'running'}
                  eventsUrl={`/api/share/${token}/runs/${run.id}/events`}
                  streamUrl={`/api/share/${token}/runs/${run.id}/stream`}
                />
              ))
          )}
        </div>
        <footer className="share-readonly">Nur lesen — über diesen Link kann niemand schreiben.</footer>
      </section>
    </DevShell>
  );
}
