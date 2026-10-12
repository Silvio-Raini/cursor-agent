import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
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
  canWrite: boolean;
  runs: Run[];
};

type ShareView = { locked: true } | { locked: false; chat: PublicChat };

export function SharePage() {
  const { token = '' } = useParams();
  const [phase, setPhase] = useState<'loading' | 'invalid' | 'expired' | 'locked' | 'open'>('loading');
  const [chat, setChat] = useState<PublicChat | null>(null);
  const [password, setPassword] = useState('');
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState('');
  const [sendError, setSendError] = useState('');
  const [busy, setBusy] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

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
          <p className="login-foot">Der Chat bleibt auf diesem Server.</p>
        </div>
      </div>
    );
  }

  const liveRunId = chat.runs.find((r) => r.status === 'running')?.id || null;
  const queuedCount = chat.runs.filter((r) => r.status === 'queued').length;
  const sessionBusy = Boolean(liveRunId) || queuedCount > 0;

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || !chat?.canWrite) return;
    setBusy(true);
    setSendError('');
    try {
      const data = await api<ShareView>(`/api/share/${token}/send`, {
        method: 'POST',
        json: { prompt: prompt.trim() },
      });
      setPrompt('');
      apply(data);
      chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'SHARE_READONLY') {
        setSendError('Schreiben wurde für diesen Chat ausgeschaltet.');
        await load(true);
      } else if (code === 'SHARE_LOCKED') {
        setPhase('locked');
        setChat(null);
      } else {
        setSendError(err instanceof Error ? err.message : 'Senden fehlgeschlagen.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function cancel(runId: string) {
    setBusy(true);
    setSendError('');
    try {
      const data = await api<ShareView>(`/api/share/${token}/runs/${runId}/cancel`, {
        method: 'POST',
        json: {},
      });
      apply(data);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Abbrechen fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <DevShell title={chat.title} subtitle={chat.canWrite ? 'Geteilter Chat · schreiben' : 'Geteilter Chat · nur lesen'}>
      <section className="chat-shell panel share-shell">
        <div className="chat-shell-head">
          <div className="chat-shell-title">
            <h2>{chat.title}</h2>
            <div className="chat-shell-meta">
              {chat.workspaceLabel && <span className="cwd-badge">{chat.workspaceLabel}</span>}
              <span className="pill">{chat.canWrite ? 'schreiben' : 'nur lesen'}</span>
              <span className={`pill status-${liveRunId ? 'running' : chat.status}`}>
                {sessionBusy
                  ? queuedCount > 0
                    ? `läuft · ${queuedCount} in Queue`
                    : 'läuft'
                  : chat.status === 'idle' || chat.status === 'finished'
                    ? 'bereit'
                    : chat.status}
              </span>
            </div>
          </div>
        </div>
        <div className="chat-panel" ref={chatRef}>
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
                  onCancelQueued={chat.canWrite && run.status === 'queued' ? () => void cancel(run.id) : undefined}
                  eventsUrl={`/api/share/${token}/runs/${run.id}/events`}
                  streamUrl={`/api/share/${token}/runs/${run.id}/stream`}
                />
              ))
          )}
        </div>
        {chat.canWrite ? (
          <footer className="composer">
            {sendError && <p className="form-error share-send-error">{sendError}</p>}
            <form onSubmit={(e) => void send(e)} className="composer-form">
              <div className="composer-box">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={sessionBusy ? 'Nachricht in Queue stellen…' : 'Nachricht schreiben…'}
                  rows={1}
                  disabled={busy}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
                <div className="composer-actions">
                  {liveRunId && (
                    <button type="button" className="tool-btn" onClick={() => void cancel(liveRunId)} disabled={busy}>
                      Stop
                    </button>
                  )}
                  <button
                    type="submit"
                    className="tool-btn primary btn-send"
                    disabled={busy || !prompt.trim()}
                    aria-label={sessionBusy ? 'In Queue' : 'Senden'}
                  >
                    ↑
                  </button>
                </div>
              </div>
            </form>
          </footer>
        ) : (
          <footer className="share-readonly">Nur lesen — Schreiben kann der Besitzer später freischalten.</footer>
        )}
      </section>
    </DevShell>
  );
}
