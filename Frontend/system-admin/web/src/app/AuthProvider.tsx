/**
 * Auth provider (Architecture §5). Flow:
 *   Supabase SDK sign-in (email+password) -> session (JWT) -> GET /auth/me ->
 *   gate the app on an ADMIN app User (Back Office is ADMIN-only, PRD §10 FR-BO).
 *   Logout = Supabase sign-out.
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
import { Role, type CurrentUser } from '@sitelink/shared';

/** The app user from GET /auth/me (authUserId stripped server-side). */
type AuthUser = CurrentUser['user'];
import { getSupabase } from '../lib/supabase/client';
import { isApiConfigured, isSupabaseConfigured } from '../lib/env';
import { authApi } from '../lib/api/endpoints';
import { ApiError } from '../lib/api/client';

type Status = 'loading' | 'signed-out' | 'signed-in' | 'forbidden';

interface AuthContextValue {
  status: Status;
  user: AuthUser | null;
  supabaseConfigured: boolean;
  apiConfigured: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  /**
   * Change the signed-in admin's own password. Verifies the CURRENT password first by
   * re-authenticating (Supabase updateUser alone does not check the old one), then
   * sets the new password. Throws 'old-password-invalid' when the current password is
   * wrong, 'no-user' when not signed in.
   */
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Back Office is ADMIN-only this phase (NOT manager, NOT partner). */
const BACKOFFICE_ROLES: Role[] = [Role.ADMIN];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);

  const loadProfile = useCallback(async () => {
    if (!isApiConfigured) {
      setStatus('signed-out');
      return;
    }
    try {
      const { user: appUser } = await authApi.me();
      if (BACKOFFICE_ROLES.includes(appUser.role)) {
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

  const changePassword = useCallback(
    async (oldPassword: string, newPassword: string) => {
      const supabase = getSupabase();
      if (!supabase) throw new Error('supabase-not-configured');
      const email = user?.email;
      if (!email) throw new Error('no-user');
      // Verify the CURRENT password by re-authenticating (keeps the same session).
      const { error: reauthErr } = await supabase.auth.signInWithPassword({
        email,
        password: oldPassword,
      });
      if (reauthErr) throw new Error('old-password-invalid');
      // Apply the new password on the now-verified session.
      const { error: updErr } = await supabase.auth.updateUser({ password: newPassword });
      if (updErr) throw updErr;
    },
    [user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      supabaseConfigured: isSupabaseConfigured,
      apiConfigured: isApiConfigured,
      signIn,
      signOut,
      refreshProfile: loadProfile,
      changePassword,
    }),
    [status, user, signIn, signOut, loadProfile, changePassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
