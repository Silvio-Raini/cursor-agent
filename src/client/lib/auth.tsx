import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setCsrf } from './api';

type User = { id: number; username: string; role: 'admin' | 'user' };

type AuthCtx = {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const data = await api<{ user: User | null; csrf: string | null }>('/api/auth/me');
    if (data.csrf) setCsrf(data.csrf);
    setUser(data.user);
  };

  useEffect(() => {
    void refresh().finally(() => setLoading(false));
  }, []);

  const login = async (username: string, password: string) => {
    const data = await api<{ user: User; csrf: string }>('/api/auth/login', {
      method: 'POST',
      json: { username, password },
    });
    setCsrf(data.csrf);
    setUser(data.user);
  };

  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST', json: {} });
    setUser(null);
  };

  return <Ctx.Provider value={{ user, loading, login, logout, refresh }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('AuthProvider missing');
  return ctx;
}
