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
  /**
   * The tenant this user belongs to (multi-tenancy security boundary). Always
   * SERVER-derived; a Manager/Foreman/Worker only ever sees users of their OWN
   * company. NOT NULL in the DB (every user is on a company post-migration).
   */
  companyId: ID;
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
  /**
   * TENANT for the new user. ADMIN-ONLY and MANDATORY for an ADMIN (creating a
   * Manager INTO a company): the target company must exist and not be archived.
   * IGNORED for a MANAGER — the back end always stamps the MANAGER'S OWN companyId,
   * never a client-supplied one (a Manager can never create into another company).
   */
  companyId?: ID;
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
  /** ADMIN-set the target's password (min 8). Not stored app-side; Supabase owns it. */
  password?: string;
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

/**
 * Result of `GET /auth/me`: the app User for the verified Supabase identity.
 * `authUserId` (the Supabase identity FK) is intentionally omitted — the client
 * has no use for it and it should not be cached client-side (data minimization).
 */
export interface CurrentUser {
  user: Omit<User, 'authUserId'>;
  /**
   * Display name of the tenant company the user belongs to (self-scoped: always the
   * caller's OWN company). Optional/nullable so older clients and any edge where the
   * company row is missing degrade gracefully. Read-only — surfaced in Settings.
   */
  companyName?: string | null;
  /**
   * The sites the caller works at (self-scoped). For a WORKER these are their active
   * site assignments; empty when the user has no site links. Optional so older clients
   * degrade gracefully.
   */
  sites?: { id: string; name: string }[];
}
