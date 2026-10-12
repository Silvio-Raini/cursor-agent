import { useEffect, useState } from 'react';
import { api } from '../lib/api';

type ShareInfo = {
  active: boolean;
  expired: boolean;
  token: string | null;
  url: string | null;
  createdAt: string | null;
  expiresAt: string | null;
};

type ExpiryChoice = 'keep' | 'none' | '1' | '7' | '30';

function formatWhen(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}

export function ShareDialog({
  sessionId,
  onClose,
  onChanged,
}: {
  sessionId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [password, setPassword] = useState('');
  const [passwordAgain, setPasswordAgain] = useState('');
  const [expiry, setExpiry] = useState<ExpiryChoice>('none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);

  const link = info?.token ? `${window.location.origin}/s/${info.token}` : '';

  useEffect(() => {
    let cancelled = false;
    void api<ShareInfo>(`/api/agents/sessions/${sessionId}/share`)
      .then((data) => {
        if (cancelled) return;
        setInfo(data);
        setExpiry(data.token ? 'keep' : 'none');
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Freigabe konnte nicht geladen werden.');
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  async function save(e: { preventDefault(): void }, rotateLink = false) {
    e.preventDefault();
    setError('');
    setNotice('');
    const creating = !info?.token;
    if (creating && password.length < 4) {
      setError('Passwort mindestens 4 Zeichen.');
      return;
    }
    if (password && password !== passwordAgain) {
      setError('Passwörter stimmen nicht überein.');
      return;
    }
    if (!creating && !password && !rotateLink && expiry === 'keep') {
      setNotice('Nichts geändert.');
      return;
    }
    setBusy(true);
    try {
      const body: { password?: string; expiresInDays?: number | null; rotateLink?: boolean } = {};
      if (password) body.password = password;
      if (rotateLink) body.rotateLink = true;
      if (expiry !== 'keep') body.expiresInDays = expiry === 'none' ? null : Number(expiry);
      const next = await api<ShareInfo>(`/api/agents/sessions/${sessionId}/share`, {
        method: 'PUT',
        json: body,
      });
      setInfo(next);
      setPassword('');
      setPasswordAgain('');
      setExpiry('keep');
      setNotice(rotateLink ? 'Neuer Link ist aktiv. Der alte funktioniert nicht mehr.' : 'Freigabe gespeichert.');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!window.confirm('Freigabe wirklich beenden? Der Link funktioniert danach nicht mehr.')) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/agents/sessions/${sessionId}/share`, { method: 'DELETE', json: {} });
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Beenden fehlgeschlagen.');
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError('Kopieren nicht möglich. Link bitte manuell markieren.');
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal share-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-labelledby="share-title">
        <h2 id="share-title">Chat teilen</h2>
        <p className="field-hint share-lead">
          Wer Link und Passwort hat, kann diesen Chat lesen — inklusive Tool-Ausgaben. Schreiben ist nicht möglich.
        </p>

        {!info ? (
          <p className="field-hint">Laden…</p>
        ) : (
          <form onSubmit={(e) => void save(e, false)}>
            {info.token && (
              <label>
                Link
                <div className="share-link-row">
                  <input value={link} readOnly spellCheck={false} onFocus={(e) => e.currentTarget.select()} />
                  <button type="button" className="tool-btn" onClick={() => void copyLink()}>
                    {copied ? 'Kopiert' : 'Kopieren'}
                  </button>
                </div>
                <span className="field-hint">
                  {info.expired
                    ? `Abgelaufen${info.expiresAt ? ` am ${formatWhen(info.expiresAt)}` : ''}. Ablauf verlängern oder neu speichern.`
                    : info.expiresAt
                      ? `Aktiv bis ${formatWhen(info.expiresAt)}.`
                      : 'Aktiv, ohne Ablaufdatum.'}
                </span>
              </label>
            )}

            <label>
              {info.token ? 'Neues Passwort' : 'Passwort'}
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={info.token ? undefined : 4}
                required={!info.token}
                placeholder={info.token ? 'Leer lassen, um das Passwort zu behalten' : 'Mindestens 4 Zeichen'}
              />
            </label>
            <label>
              Passwort wiederholen
              <input
                type="password"
                value={passwordAgain}
                onChange={(e) => setPasswordAgain(e.target.value)}
                autoComplete="new-password"
                required={Boolean(password) || !info.token}
              />
            </label>
            <label>
              Ablauf
              <select value={expiry} onChange={(e) => setExpiry(e.target.value as ExpiryChoice)}>
                {info.token && <option value="keep">Unverändert</option>}
                <option value="none">Kein Ablauf</option>
                <option value="1">1 Tag</option>
                <option value="7">7 Tage</option>
                <option value="30">30 Tage</option>
              </select>
            </label>

            {error && <p className="form-error">{error}</p>}
            {notice && <p className="form-ok">{notice}</p>}

            <div className="modal-actions">
              {info.token && (
                <button type="button" className="tool-btn danger" disabled={busy} onClick={() => void revoke()}>
                  Beenden
                </button>
              )}
              <button type="button" className="tool-btn" onClick={onClose} disabled={busy}>
                Schließen
              </button>
              {info.token && (
                <button type="button" className="tool-btn" disabled={busy} onClick={(e) => void save(e, true)}>
                  Link erneuern
                </button>
              )}
              <button type="submit" className="tool-btn primary" disabled={busy}>
                {busy ? 'Speichern…' : info.token ? 'Speichern' : 'Freigabe erstellen'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
