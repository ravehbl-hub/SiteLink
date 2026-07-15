/**
 * Typed REST contract for the ADMIN-only Back Office surface (PRD §10 FR-BO).
 * Bound to @sitelink/shared DTOs where they exist; the Back Office list/status
 * shapes are declared locally to mirror the back-end service projections.
 */
import type {
  CreateUserInput,
  CurrentUser,
  Paginated,
  ProfitLoss,
  Role,
  UpdateUserInput,
  User,
} from '@sitelink/shared';
import { http, rootGet, type Query } from './client';

/* ── Auth ─────────────────────────────────────────────────────────────── */
export const authApi = {
  me: () => http.get<CurrentUser>('/auth/me'),
};

/* ── Health probes (ROOT-mounted, unauthenticated — Architecture §8) ──── */
export interface HealthLiveness {
  status: string;
  service: string;
  uptimeSeconds: number;
  timestamp: string;
}
/** /health/db returns 200 {status:'ok',db:'up',latencyMs} or 503 {status:'degraded',db:'down'}. */
export interface HealthDb {
  status: string;
  db: 'up' | 'down';
  latencyMs?: number;
}
export const healthApi = {
  liveness: (signal?: AbortSignal) => rootGet<HealthLiveness>('/health', signal),
  db: (signal?: AbortSignal) => rootGet<HealthDb>('/health/db', signal),
};

/* ── Back Office (ADMIN-only, under /api/v1) ──────────────────────────── */

/** A user row projected to non-sensitive fields (NO authUserId / password). */
export interface BackOfficeUser {
  id: string;
  fullName: string;
  email: string;
  role: string;
  isLockedOut: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** System status projection (mirrors /health/db semantics, no secrets). */
export interface BackOfficeStatus {
  service: string;
  uptimeSeconds: number;
  db: 'up' | 'down';
  dbLatencyMs: number | null;
  timestamp: string;
}

export interface ProfitLossParams {
  siteId?: string;
  from: string;
  to: string;
  revenue?: number;
  currency?: string;
}

export const backOfficeApi = {
  status: () => http.get<BackOfficeStatus>('/backoffice/status'),
  users: () => http.get<BackOfficeUser[]>('/backoffice/users'),
  profitLoss: (params: ProfitLossParams) =>
    http.get<ProfitLoss>('/backoffice/profit-loss', params as unknown as Query),
};

/* ── Users CRUD (FR-MGR-USER, ADMIN-scoped) ───────────────────────────────
 * The Manager/Admin-gated /users routes. ADMIN callers may list & manage any
 * role (incl. ADMIN) via the OPTIONAL ?role filter. All list endpoints return
 * a Paginated<T> envelope — consume `.items`, never the bare response. */
export interface ListUsersParams {
  role?: Role;
  page?: number;
  pageSize?: number;
}
export const usersApi = {
  list: (params?: ListUsersParams) =>
    http.get<Paginated<User>>('/users', params as Query),
  get: (id: string) => http.get<User>(`/users/${id}`),
  create: (body: CreateUserInput) => http.post<User>('/users', body),
  update: (id: string, body: UpdateUserInput) => http.patch<User>(`/users/${id}`, body),
  lockout: (id: string, isLockedOut: boolean) =>
    http.post<User>(`/users/${id}/lockout`, { isLockedOut }),
  remove: (id: string) => http.del<void>(`/users/${id}`),
};
