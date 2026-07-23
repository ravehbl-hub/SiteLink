/**
 * Auth context (Architecture §5). Supabase SDK owns the session; on a live session
 * we call GET /auth/me to resolve the app User (role + prefs) and gate the app to
 * Manager/Admin. Login = supabase.auth.signInWithPassword; logout = signOut.
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
  /** Read-only display name of the caller's OWN tenant company (from /auth/me). */
  companyName: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<void>;
  /**
   * Change the signed-in user's own password. Supabase owns credentials, so this
   * updates the Supabase identity directly (a live session authorizes it) — there
   * is no backend password store to touch.
   */
  changePassword: (newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const MANAGER_ROLES: Role[] = [Role.MANAGER, Role.ADMIN];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>(config.isConfigured ? 'loading' : 'unconfigured');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);

  async function resolveMe(): Promise<void> {
    try {
      const { user: me, companyName: company } = await endpoints.me();
      if (!MANAGER_ROLES.includes(me.role)) {
        setUser(null);
        setCompanyName(null);
        setStatus('unauthorized');
        return;
      }
      setUser(me);
      setCompanyName(company ?? null);
      setStatus('signedIn');
    } catch (e) {
      // A verified session that /auth/me rejects → treat as unauthorized, not a crash.
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        setStatus('unauthorized');
      } else {
        setStatus('signedOut');
      }
      setUser(null);
      setCompanyName(null);
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
        setCompanyName(null);
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
    setCompanyName(null);
    setStatus('signedOut');
  }

  async function changePassword(newPassword: string): Promise<void> {
    if (!supabase) throw new ApiError(0, 'NOT_CONFIGURED', 'App is not configured.');
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw new ApiError(400, 'PASSWORD_UPDATE_FAILED', error.message);
  }

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, companyName, signIn, signOut, refreshMe: resolveMe, changePassword }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [status, user, companyName],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
