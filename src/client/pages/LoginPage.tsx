import { useState, type FormEvent } from 'react';
import { ThemeToggle } from '../components/ThemeToggle';

export function LoginPage({ onLogin }: { onLogin: (u: string, p: string) => Promise<void> }) {
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
    <div className="page login-page">
      <div className="login-card panel">
        <div className="login-top">
          <div className="brand-group">
            <span className="brand-mark" aria-hidden="true" />
            <div>
              <p className="brand-title">Cursor Agent</p>
              <p className="brand-sub">Self-hosted · @cursor/sdk</p>
            </div>
          </div>
          <ThemeToggle />
        </div>
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
          <button type="submit" className="tool-btn primary btn-block" disabled={busy}>
            {busy ? 'Anmelden…' : 'Anmelden'}
          </button>
        </form>
        <p className="login-foot">Self-hosted · @cursor/sdk · Open Source ready</p>
      </div>
    </div>
  );
}
