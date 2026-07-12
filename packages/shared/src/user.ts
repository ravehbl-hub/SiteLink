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
 * SECURITY: passwordHash is server-only and MUST NOT be serialized to clients
 * (NFR-SEC-1). It is intentionally omitted from the wire-facing `User` type;
 * see `UserRecord` for the persisted shape hint.
 */
export interface User extends Timestamped {
  id: ID;
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

/** Create-user payload (FR-MGR-USER-1). Password is plaintext in transit only (TLS), hashed at rest. */
export interface CreateUserInput {
  role: Role;
  fullName: string;
  email: string;
  password: string;
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

/** Auth: login request/response (Architecture §5 — JWT access + refresh). */
export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthSession {
  user: User;
  tokens: AuthTokens;
}
