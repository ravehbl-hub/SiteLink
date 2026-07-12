/**
 * Auth provider (Architecture §5). Flow:
 *   Supabase SDK sign-in (email+password) -> session (JWT) -> GET /auth/me ->
 *   gate the app on a Manager/Admin app User. Logout = Supabase sign-out.
 *
 * Gracefully degrades when Supabase / API are not configured: exposes `configured`
 * flags so the UI can show a clear "set VITE_* env" state rather than crashing.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { Role, type User } from '@sitelink/shared';
import { getSupabase } from '../lib/supabase/client';
import { isApiConfigured, isSupabaseConfigured } from '../lib/env';
import { authApi } from '../lib/api/endpoints';
import { ApiError } from '../lib/api/client';

type Status = 'loading' | 'signed-out' | 'signed-in' | 'forbidden';

interface AuthContextValue {
  status: Status;
  user: User | null;
  supabaseConfigured: boolean;
  apiConfigured: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const MANAGER_ROLES: Role[] = [Role.MANAGER, Role.ADMIN];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<User | null>(null);

  const loadProfile = useCallback(async () => {
    if (!isApiConfigured) {
      setStatus('signed-out');
      return;
    }
    try {
      const { user: appUser } = await authApi.me();
      if (MANAGER_ROLES.includes(appUser.role)) {
        setUser(appUser);
        setStatus('signed-in');
      } else {
        setUser(appUser);
        setStatus('forbidden');
      }
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setStatus('signed-out');
        setUser(null);
      } else {
        // Network / server error: treat as signed-out so the login screen shows.
        setStatus('signed-out');
        setUser(null);
      }
    }
  }, []);

  // React to Supabase session changes (initial hydrate + refresh + sign-out).
  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      setStatus('signed-out');
      return;
    }
    let active = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) void loadProfile();
      else setStatus('signed-out');
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (session) void loadProfile();
      else {
        setUser(null);
        setStatus('signed-out');
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    const supabase = getSupabase();
    if (!supabase) throw new Error('supabase-not-configured');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    // onAuthStateChange triggers loadProfile.
  }, []);

  const signOut = useCallback(async () => {
    const supabase = getSupabase();
    if (supabase) await supabase.auth.signOut();
    setUser(null);
    setStatus('signed-out');
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      supabaseConfigured: isSupabaseConfigured,
      apiConfigured: isApiConfigured,
      signIn,
      signOut,
      refreshProfile: loadProfile,
    }),
    [status, user, signIn, signOut, loadProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
