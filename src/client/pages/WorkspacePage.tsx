import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { RunThread } from '../components/RunThread';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';

type Session = {
  id: string;
  title: string;
  cwd: string;
  workspaceLabel: string | null;
  model: string;
  status: string;
  updatedAt: string;
  lastRunAt: string | null;
};

type Run = {
  id: string;
  sessionId: string;
  prompt: string;
  status: string;
  errorMessage: string | null;
};

type Meta = {
  allowAnyPath: boolean;
  hasWorkspaceAllowlist: boolean;
  defaultModel: string;
  models: Array<{ id: string; label: string }>;
  settings: { hasApiKey: boolean; apiKeyMasked: string };
};

function projectLabel(cwd: string, workspaceLabel: string | null): string {
  if (workspaceLabel) return workspaceLabel;
  const parts = cwd.split('/').filter(Boolean);
  return parts[parts.length - 1] || cwd;
}

export function WorkspacePage() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newCwd, setNewCwd] = useState('');
  const [newModel, setNewModel] = useState('');
  const [newPrompt, setNewPrompt] = useState('');
  const chatRef = useRef<HTMLDivElement>(null);

  const selected = sessions.find((s) => s.id === selectedId) || null;
  const liveRunId = runs.find((r) => r.status === 'running' || r.status === 'queued')?.id || null;

  const load = useCallback(async () => {
    const [m, list] = await Promise.all([
      api<Meta>('/api/agents/meta'),
      api<Session[]>('/api/agents/sessions'),
    ]);
    setMeta(m);
    setSessions(list);
    if (m.defaultModel && !newModel) setNewModel(m.defaultModel);
    if (!selectedId && list[0]) setSelectedId(list[0].id);
  }, [newModel, selectedId]);

  const loadDetail = useCallback(async (id: string) => {
    const data = await api<{ session: Session; runs: Run[] }>(`/api/agents/sessions/${id}`);
    setRuns(data.runs);
  }, []);

  useEffect(() => {
    void load().catch(console.error);
  }, [load]);

  useEffect(() => {
    if (!selectedId) return;
    void loadDetail(selectedId).catch(console.error);
    const t = setInterval(() => void loadDetail(selectedId).catch(() => undefined), 5000);
    return () => clearInterval(t);
  }, [selectedId, loadDetail]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const cwd = newCwd.trim();
      const label = projectLabel(cwd, null);
      const result = await api<{ session: Session; run?: Run }>('/api/agents/sessions', {
        method: 'POST',
        json: {
          cwd,
          workspaceLabel: label,
          model: newModel,
          prompt: newPrompt || undefined,
        },
      });
      setShowNew(false);
      setNewPrompt('');
      await load();
      setSelectedId(result.session.id);
      if (result.session.id) await loadDetail(result.session.id);
    } finally {
      setBusy(false);
    }
  }

  async function onSend(e: FormEvent) {
    e.preventDefault();
    if (!selectedId || !prompt.trim()) return;
    setBusy(true);
    try {
      await api<Run>(`/api/agents/sessions/${selectedId}/send`, {
        method: 'POST',
        json: { prompt: prompt.trim() },
      });
      setPrompt('');
      await loadDetail(selectedId);
      await load();
      chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' });
    } finally {
      setBusy(false);
    }
  }

  async function onCancel() {
    if (!liveRunId) return;
    setBusy(true);
    try {
      await api(`/api/agents/runs/${liveRunId}/cancel`, { method: 'POST', json: {} });
      if (selectedId) await loadDetail(selectedId);
      await load();
    } finally {
      setBusy(false);
    }
  }

  const noKey = Boolean(meta && !meta.settings.hasApiKey);

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-head">
          <span className="brand-mark">CA</span>
          <div>
            <strong>Cursor Agent</strong>
            <span>{user?.username}</span>
          </div>
        </div>
        <button type="button" className="btn btn-primary btn-block" onClick={() => setShowNew(true)}>
          + Neue Session
        </button>
        <nav className="session-nav">
          {sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`session-item${selectedId === s.id ? ' active' : ''}`}
              onClick={() => setSelectedId(s.id)}
            >
              <span className="session-title">{s.title}</span>
              <span className="session-meta">{projectLabel(s.cwd, s.workspaceLabel)}</span>
              <span className={`status-dot ${s.status}`} />
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          {user?.role === 'admin' && (
            <a className="btn btn-ghost btn-block" href="/settings">
              Einstellungen
            </a>
          )}
          <button type="button" className="btn btn-ghost btn-block" onClick={() => void logout()}>
            Abmelden
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="main-head">
          <div className="main-head-inner">
            <h1>{selected?.title || 'Session'}</h1>
            {selected && (
              <span className="cwd-badge">{projectLabel(selected.cwd, selected.workspaceLabel)}</span>
            )}
            {selected && <span className={`pill status-${selected.status}`}>{selected.status}</span>}
          </div>
          <button type="button" className="theme-toggle" onClick={toggle} aria-label="Theme">
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </header>

        {noKey && (
          <div className="banner banner-warn">
            Cursor API-Key fehlt —{' '}
            {user?.role === 'admin' ? (
              <a href="/settings">in Einstellungen hinterlegen</a>
            ) : (
              'bitte Admin kontaktieren'
            )}
          </div>
        )}

        <div className="chat-panel" ref={chatRef}>
          {!selected ? (
            <div className="empty-state">
              <p>Starte eine neue Session oder wähle eine aus der Liste.</p>
            </div>
          ) : (
            runs
              .slice()
              .reverse()
              .map((run, i) => (
                <RunThread
                  key={run.id}
                  run={run}
                  isFirst={i === 0}
                  live={run.id === liveRunId && (run.status === 'running' || run.status === 'queued')}
                />
              ))
          )}
        </div>

        {selected && (
          <footer className="composer">
            <form onSubmit={onSend} className="composer-form">
              <div className="composer-box">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Ask Cursor…"
                  rows={1}
                  disabled={busy || selected.status === 'running' || noKey}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
                <div className="composer-actions">
                  {selected.status === 'running' && liveRunId && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void onCancel()} disabled={busy}>
                      Stop
                    </button>
                  )}
                  <button
                    type="submit"
                    className="btn btn-primary btn-sm"
                    disabled={busy || !prompt.trim() || selected.status === 'running' || noKey}
                    aria-label="Senden"
                  >
                    ↑
                  </button>
                </div>
              </div>
            </form>
          </footer>
        )}
      </main>

      {showNew && (
        <div className="modal-backdrop" onClick={() => setShowNew(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Neue Session</h2>
            <form onSubmit={onCreate}>
              <label>
                Projekt-Pfad
                <input
                  type="text"
                  value={newCwd}
                  onChange={(e) => setNewCwd(e.target.value)}
                  placeholder="/pfad/zum/projekt"
                  required
                  spellCheck={false}
                />
                <span className="field-hint">
                  Absoluter Pfad auf dem Server, in dem der Agent arbeiten soll.
                  {meta?.hasWorkspaceAllowlist && !meta.allowAnyPath
                    ? ' Nur erlaubte Pfade aus WORKSPACES.'
                    : meta?.allowAnyPath
                      ? ' Beliebiger existierender Pfad erlaubt.'
                      : ' WORKSPACES oder AGENT_ALLOW_ANY_PATH in .env konfigurieren.'}
                </span>
              </label>
              <label>
                Modell
                <select value={newModel} onChange={(e) => setNewModel(e.target.value)}>
                  {(meta?.models || []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Erster Prompt (optional)
                <textarea value={newPrompt} onChange={(e) => setNewPrompt(e.target.value)} rows={4} />
              </label>
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setShowNew(false)}>
                  Abbrechen
                </button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  Starten
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
