/**
 * @sitelink/shared — Users & Auth domain.
 * Users & Auth (PRD §12, FR-MGR-USER, FR-X-RBAC). v1-active.
 */
import type { ID, ISODate, Timestamped } from './common';
import { Language, Role, Theme } from './enums';

/**
 * A system user across all five role surfaces.
 * v1 authenticates Manager (+ Admin); Foreman/Worker/Partner are provisioned
 * by the Manager (FR-MGR-USER-1) but their apps are future.
 *
 * AUTH SPLIT: authentication (credentials, sessions, password reset) is owned by
 * Supabase Auth; this record owns AUTHORIZATION (role + site scope) as application
 * data. `authUserId` is the Supabase auth user id (the identity FK). No password
 * hash is stored here — Supabase holds credentials (NFR-SEC-1).
 */
export interface User extends Timestamped {
  id: ID;
  /** Supabase Auth user id — the identity this app-level record authorizes. */
  authUserId: ID;
  role: Role;
  fullName: string;
  email: string;
  /** Reversible lockout: prevents auth without deleting the account (FR-MGR-USER-3). */
  isLockedOut: boolean;
  /** Primary construction-site association captured at creation (FR-MGR-USER-1). */
  primarySiteId?: ID | null;
  /** Per-user preferences persist across sessions/devices (FR-X-I18N-3, FR-X-THEME-2). */
  language: Language;
  theme: Theme;
  lastLoginAt?: ISODate | null;
}

/** Per-user preference bundle (Settings — FR-MGR-SET). */
export interface UserPreferences {
  language: Language;
  theme: Theme;
}

/**
 * Create-user payload (FR-MGR-USER-1). The back end provisions the identity via the
 * Supabase Admin API (invite or create) and dual-writes this app User row (role +
 * site scope), keyed by the returned Supabase auth user id. `password` is optional:
 * when omitted the user is invited and sets their own password via Supabase.
 */
export interface CreateUserInput {
  role: Role;
  fullName: string;
  email: string;
  /** Optional — omit to send a Supabase invite; the user sets their own password. */
  password?: string;
  primarySiteId?: ID | null;
  language?: Language;
  theme?: Theme;
}

/** Edit-user payload (FR-MGR-USER-2). */
export interface UpdateUserInput {
  fullName?: string;
  email?: string;
  role?: Role;
  primarySiteId?: ID | null;
  isLockedOut?: boolean;
  language?: Language;
  theme?: Theme;
}

/**
 * Auth (Architecture §5 — Supabase Auth). Sign-in is performed by the Supabase
 * client SDK on web/native, which returns a Supabase session (access + refresh
 * JWTs). The back end verifies that JWT and resolves the app-level User below.
 * These types describe the client-facing shape; SiteLink no longer issues its own
 * tokens.
 */
export interface LoginInput {
  email: string;
  password: string;
}

/** Supabase-issued session tokens (mirror of the SDK session, wire-facing subset). */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
}

/** Resolved session: the Supabase tokens plus this app's authorization record. */
export interface AuthSession {
  user: User;
  tokens: AuthTokens;
}

/** Result of `GET /auth/me`: the app User for the verified Supabase identity. */
export interface CurrentUser {
  user: User;
}
