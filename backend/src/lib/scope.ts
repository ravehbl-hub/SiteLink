/**
 * SiteLink back end — role SCOPE resolution (Phase 05 Stage B, SECURITY BOUNDARY).
 *
 * requireRole is the coarse gate (which roles may touch a route). This module is the
 * FINE-GRAINED, per-caller data boundary that services MUST apply so a FOREMAN can
 * only ever read/write their own site(s), derived entirely from the SERVER-side
 * `req.appUser` — never from a client-supplied siteId/workerId that hasn't been
 * validated against the caller's scope.
 *
 * Foreman → site(s) mapping decision (documented):
 *   The schema has NO foreman→site assignment model. `SiteAssignment` is worker↔site.
 *   The only link from a FOREMAN User to a Site is `User.primarySiteId`. A Foreman is
 *   therefore scoped to the single site set { primarySiteId }. If a Foreman has no
 *   primarySiteId, their scope is EMPTY → every scoped read returns nothing and every
 *   scoped write is 403 (fail-closed). A future multi-site foreman needs a dedicated
 *   ForemanAssignment model; this helper is the single place that would change.
 *
 * ADMIN / MANAGER are UNSCOPED here (they already pass requireRole on the full
 * Manager surface); scope helpers return `null` (= "all sites") for them.
 */
import { Role } from '@sitelink/shared';
import { prisma } from '../db/client.js';
import { AppError } from './errors.js';
import type { AuthUser } from '../plugins/types.js';

/**
 * The set of site ids a caller may see, or `null` for "all sites" (ADMIN/MANAGER).
 * A FOREMAN always gets a concrete array (possibly empty).
 */
export type SiteScope = { siteIds: string[] } | { all: true };

/** True when the caller is a FOREMAN (the only role we site-scope in Stage B). */
export function isForeman(user: AuthUser): boolean {
  return user.role === Role.FOREMAN;
}

/** True when the caller is a WORKER (self-scoped surfaces). */
export function isWorker(user: AuthUser): boolean {
  return user.role === Role.WORKER;
}

/**
 * WORKER → Worker resolution (Phase 05 Stage B SECURITY JOIN).
 *
 * Given a WORKER caller (`req.appUser`), resolve THEIR own Worker row id via the
 * ONLY safe link — the 1:1 `Worker.userId` FK (Savant's `WorkerLogin` relation).
 * We NEVER fall back to email (nullable + non-unique = spoofable). If the caller
 * has no linked Worker row the result is fail-closed: the endpoint must treat the
 * caller as having no worker data (403 for writes, empty for reads).
 *
 * Returns the resolved Worker id, or `null` when the caller (a WORKER) has no
 * linked worker record. Callers that reach this with a non-WORKER role are
 * mis-wired → 403 (this helper is only for the WORKER self surface).
 */
export async function resolveWorkerId(user: AuthUser): Promise<string | null> {
  if (user.role !== Role.WORKER) {
    // Only the WORKER self surface uses this join. Anyone else is mis-routed.
    throw AppError.forbidden();
  }
  const worker = await prisma.worker.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });
  return worker?.id ?? null;
}

/**
 * Like `resolveWorkerId` but throws 403 when the WORKER has no linked Worker row —
 * for WRITE paths where "no worker record" must be a hard denial, never a silent
 * no-op. Reads that should return an empty set use `resolveWorkerId` and branch.
 */
export async function requireWorkerId(user: AuthUser): Promise<string> {
  const workerId = await resolveWorkerId(user);
  if (!workerId) throw AppError.forbidden();
  return workerId;
}

/**
 * Resolve the caller's site scope. ADMIN/MANAGER → { all: true } (unscoped).
 * FOREMAN → { siteIds: [...] } derived from primarySiteId (empty if unset).
 * Any other role reaching here is a mis-wired route → 403 (fail-closed).
 */
export function resolveSiteScope(user: AuthUser): SiteScope {
  if (user.role === Role.ADMIN || user.role === Role.MANAGER) {
    return { all: true };
  }
  if (user.role === Role.FOREMAN) {
    return { siteIds: user.primarySiteId ? [user.primarySiteId] : [] };
  }
  // PARTNER/WORKER must never reach a Foreman-scoped service.
  throw AppError.forbidden();
}

/**
 * Validate a client-supplied `siteId` against the caller's scope and return the
 * EFFECTIVE site filter to apply:
 *   - ADMIN/MANAGER: pass through the requested siteId (or undefined = all).
 *   - FOREMAN with a requested siteId: must be inside their scope, else 403.
 *   - FOREMAN with NO requested siteId: defaults to their scope
 *       · exactly one site  → that site id
 *       · empty scope       → 403 (no site configured; nothing to default to)
 *       · (future) >1 site  → undefined here + the service filters by the id set.
 *
 * Returns `{ siteId }` — a single effective site id, or `undefined` meaning
 * "no single-site filter" (ADMIN/MANAGER all-sites). For a Foreman the returned
 * siteId is ALWAYS one they own; a Foreman never gets `undefined`.
 */
export function effectiveSiteId(
  user: AuthUser,
  requestedSiteId: string | undefined,
): string | undefined {
  const scope = resolveSiteScope(user);
  if ('all' in scope) {
    return requestedSiteId; // ADMIN/MANAGER: trusted as-is (may be undefined = all).
  }
  // FOREMAN.
  if (scope.siteIds.length === 0) {
    // No site configured → nothing they may see. Fail closed.
    throw AppError.forbidden();
  }
  if (requestedSiteId !== undefined) {
    if (!scope.siteIds.includes(requestedSiteId)) {
      // Cross-site probe (?siteId=<other>) → 403, never trusted.
      throw AppError.forbidden();
    }
    return requestedSiteId;
  }
  // No siteId supplied → default to the Foreman's (single) site.
  return scope.siteIds[0];
}

/**
 * Assert that a given worker is assigned to a site the caller may act on.
 * ADMIN/MANAGER: always allowed. FOREMAN: the worker must have a non-unassigned
 * SiteAssignment to one of the Foreman's sites; otherwise 403 (no cross-site write).
 *
 * Uses SiteAssignment (worker↔site) — the same relation Manager attendance/dashboard
 * use to scope by site. Only ACTIVE assignments (unassignedAt = null) count.
 */
export async function assertWorkerInScope(
  user: AuthUser,
  workerId: string,
): Promise<void> {
  const scope = resolveSiteScope(user);
  if ('all' in scope) return;
  if (scope.siteIds.length === 0) throw AppError.forbidden();

  const assignment = await prisma.siteAssignment.findFirst({
    where: {
      workerId,
      siteId: { in: scope.siteIds },
      unassignedAt: null,
    },
    select: { id: true },
  });
  if (!assignment) {
    // Worker is not on the Foreman's site(s) → terse 403, no row detail leaked.
    throw AppError.forbidden();
  }
}
