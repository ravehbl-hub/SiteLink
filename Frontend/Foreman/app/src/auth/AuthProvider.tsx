/**
 * Auth context (Architecture §5) — Foreman app. Supabase SDK owns the session; on a
 * live session we call GET /auth/me to resolve the app User (role + primarySiteId)
 * and gate the app to FOREMAN (ADMIN/MANAGER may also inspect the Foreman surface).
 * Login = supabase.auth.signInWithPassword; logout = signOut.
 *
 * SCOPE RULE: a Foreman's authorized scope is the UNION of primarySiteId + active
 * ForemanSiteAssignment rows (multi-site), enforced server-side. This provider surfaces
 * primarySiteId; ActiveSiteProvider derives the pickable union from it and owns which
 * site is currently active (see src/site/ActiveSiteProvider.tsx + SitePicker.tsx).
 */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Role, type CurrentUser } from '@sitelink/shared';

/** The app user as returned by GET /auth/me (authUserId is stripped server-side). */
type AuthUser = CurrentUser['user'];
import { supabase } from '../lib/supabase';
import { config } from '../lib/config';
import { endpoints } from '../lib/endpoints';
import { ApiError } from '../lib/api';

type Status = 'loading' | 'signedOut' | 'signedIn' | 'unauthorized' | 'unconfigured';

interface AuthContextValue {
  status: Status;
  user: AuthUser | null;
  /** The Foreman's single scoped site (User.primarySiteId), or null if unassigned. */
  primarySiteId: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Foreman surface: the Foreman role, plus Admin/Manager for oversight. */
const FOREMAN_ROLES: Role[] = [Role.FOREMAN, Role.MANAGER, Role.ADMIN];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>(config.isConfigured ? 'loading' : 'unconfigured');
  const [user, setUser] = useState<AuthUser | null>(null);

  async function resolveMe(): Promise<void> {
    try {
      const { user: me } = await endpoints.me();
      if (!FOREMAN_ROLES.includes(me.role)) {
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
    () => ({
      status,
      user,
      primarySiteId: user?.primarySiteId ?? null,
      signIn,
      signOut,
      refreshMe: resolveMe,
    }),
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
