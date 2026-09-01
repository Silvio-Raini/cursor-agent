let csrf = '';

export function setCsrf(token: string) {
  csrf = token;
}

export async function api<T>(path: string, opts: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(opts.headers || {});
  if (opts.json !== undefined) headers.set('Content-Type', 'application/json');
  if (opts.method && opts.method !== 'GET') headers.set('X-CSRF-Token', csrf);

  const res = await fetch(path, {
    ...opts,
    headers,
    credentials: 'include',
    body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body,
  });

  const payload = await res.json().catch(() => ({ success: false, error: { message: 'Bad response' } }));
  if (!res.ok || payload.success === false) {
    throw Object.assign(new Error(payload.error?.message || res.statusText), { code: payload.error?.code });
  }
  return payload.data as T;
}
