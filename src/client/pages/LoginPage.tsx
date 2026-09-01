import { useState, type FormEvent } from 'react';
import { useTheme } from '../lib/theme';

export function LoginPage({ onLogin }: { onLogin: (u: string, p: string) => Promise<void> }) {
  const { theme, toggle } = useTheme();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onLogin(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-glow" aria-hidden="true" />
      <div className="login-card">
        <div className="login-top">
          <span className="brand-mark lg">CA</span>
          <button type="button" className="theme-toggle" onClick={toggle} aria-label="Theme">
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
        <h1>Cursor Agent</h1>
        <p className="login-lead">Lokale Agents auf deinem Server — Code ändern, Befehle ausführen, Follow-ups senden.</p>
        <form onSubmit={submit} className="login-form">
          <label>
            Benutzername
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
          </label>
          <label>
            Passwort
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Anmelden…' : 'Anmelden'}
          </button>
        </form>
        <p className="login-foot">Self-hosted · @cursor/sdk · Open Source ready</p>
      </div>
    </div>
  );
}
