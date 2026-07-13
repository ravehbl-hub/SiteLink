/**
 * Auth context (Architecture §5). Supabase SDK owns the session; on a live session
 * we call GET /auth/me to resolve the app User (role + prefs) and gate the app to
 * the WORKER role. Login = supabase.auth.signInWithPassword; logout = signOut.
 *
 * A verified non-Worker identity is surfaced as `unauthorized` so the login screen
 * can show the role-mismatch banner (auth.notWorker).
 */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Role, type User } from '@sitelink/shared';
import { supabase } from '../lib/supabase';
import { config } from '../lib/config';
import { endpoints } from '../lib/endpoints';
import { ApiError } from '../lib/api';

type Status = 'loading' | 'signedOut' | 'signedIn' | 'unauthorized' | 'unconfigured';

interface AuthContextValue {
  status: Status;
  user: User | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const WORKER_ROLES: Role[] = [Role.WORKER];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>(config.isConfigured ? 'loading' : 'unconfigured');
  const [user, setUser] = useState<User | null>(null);

  async function resolveMe(): Promise<void> {
    try {
      const { user: me } = await endpoints.me();
      if (!WORKER_ROLES.includes(me.role)) {
        setUser(null);
        setStatus('unauthorized');
        return;
      }
      setUser(me);
      setStatus('signedIn');
    } catch (e) {
      // A verified session that /auth/me rejects → treat as unauthorized, not a crash.
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        setStatus('unauthorized');
      } else {
        setStatus('signedOut');
      }
      setUser(null);
    }
  }

  useEffect(() => {
    if (!supabase) return;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        await resolveMe();
      } else {
        setStatus('signedOut');
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        void resolveMe();
      } else {
        setUser(null);
        setStatus('signedOut');
      }
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signIn(email: string, password: string): Promise<void> {
    if (!supabase) throw new ApiError(0, 'NOT_CONFIGURED', 'App is not configured.');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new ApiError(401, 'INVALID_CREDENTIALS', error.message);
    // onAuthStateChange fires resolveMe; also do it inline so callers can await gating.
    await resolveMe();
  }

  async function signOut(): Promise<void> {
    if (supabase) await supabase.auth.signOut();
    setUser(null);
    setStatus('signedOut');
  }

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, signIn, signOut, refreshMe: resolveMe }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [status, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
