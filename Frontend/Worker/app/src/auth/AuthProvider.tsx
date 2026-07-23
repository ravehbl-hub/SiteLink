/**
 * Auth context (Architecture §5). Supabase SDK owns the session; on a live session
 * we call GET /auth/me to resolve the app User (role + prefs) and gate the app to
 * the WORKER role. Login = supabase.auth.signInWithPassword; logout = signOut.
 *
 * A verified non-Worker identity is surfaced as `unauthorized` so the login screen
 * can show the role-mismatch banner (auth.notWorker).
 */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Role, type CurrentUser } from '@sitelink/shared';

/** The app user from GET /auth/me (authUserId stripped server-side). */
type AuthUser = CurrentUser['user'];
import { supabase } from '../lib/supabase';
import { config } from '../lib/config';
import { endpoints } from '../lib/endpoints';
import { ApiError } from '../lib/api';

type Status = 'loading' | 'signedOut' | 'signedIn' | 'unauthorized' | 'unconfigured';

interface AuthContextValue {
  status: Status;
  user: AuthUser | null;
  /** The sites the worker works at (from /auth/me). Empty when none. */
  sites: { id: string; name: string }[];
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const WORKER_ROLES: Role[] = [Role.WORKER];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>(config.isConfigured ? 'loading' : 'unconfigured');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sites, setSites] = useState<{ id: string; name: string }[]>([]);

  async function resolveMe(): Promise<void> {
    try {
      const { user: me, sites: mySites } = await endpoints.me();
      if (!WORKER_ROLES.includes(me.role)) {
        setUser(null);
        setSites([]);
        setStatus('unauthorized');
        return;
      }
      setUser(me);
      setSites(mySites ?? []);
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
    setSites([]);
    setStatus('signedOut');
  }

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, sites, signIn, signOut, refreshMe: resolveMe }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [status, user, sites],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
