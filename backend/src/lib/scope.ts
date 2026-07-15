/**
 * SiteLink back end — role SCOPE resolution (Phase 05 Stage B, SECURITY BOUNDARY).
 *
 * requireRole is the coarse gate (which roles may touch a route). This module is the
 * FINE-GRAINED, per-caller data boundary that services MUST apply so a FOREMAN can
 * only ever read/write their own site(s), derived entirely from the SERVER-side
 * `req.appUser` — never from a client-supplied siteId/workerId that hasn't been
 * validated against the caller's scope.
 *
 * Foreman → site(s) mapping (MULTI-SITE, Foreman multi-site feature):
 *   A FOREMAN's authorized scope is the UNION of:
 *     1. `User.primarySiteId` (their DEFAULT/primary site), if set, PLUS
 *     2. every ACTIVE `ForemanSiteAssignment` (unassignedAt = null) for that foreman.
 *   Existing single-site foremen keep working with zero backfill: their primary stays
 *   in the union. A foreman with NO primarySiteId AND NO active assignments → EMPTY
 *   union → every scoped read returns nothing and every scoped write is 403
 *   (fail-closed). Resolving the union requires a DB read (assignments), so the scope
 *   helpers below are ASYNC.
 *
 * ADMIN / MANAGER are UNSCOPED here (they already pass requireRole on the full
 * Manager surface); scope helpers return `{ all: true }` (= "all sites") for them.
 */
import { Role } from '@sitelink/shared';
import { prisma } from '../db/client.js';
import { AppError } from './errors.js';
import type { AuthUser } from '../plugins/types.js';

/**
 * The set of site ids a caller may see, or `{ all: true }` for "all sites"
 * (ADMIN/MANAGER). A FOREMAN always gets a concrete array (possibly empty).
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
 * Resolve the caller's site scope (ASYNC — a FOREMAN's union needs a DB read).
 *   - ADMIN/MANAGER → { all: true } (unscoped).
 *   - FOREMAN → { siteIds: [union of primarySiteId + active assignments] }
 *     (deduped; empty if neither a primary nor any active assignment exists).
 *   - Any other role reaching here is a mis-wired route → 403 (fail-closed).
 *
 * SECURITY: the union is built ONLY from server-side truth (req.appUser.primarySiteId
 * and ForemanSiteAssignment rows filtered on unassignedAt = null). It never includes
 * a site the foreman is not primary-on or actively assigned to; an unassigned pair
 * (unassignedAt set) is EXCLUDED.
 */
export async function resolveSiteScope(user: AuthUser): Promise<SiteScope> {
  if (user.role === Role.ADMIN || user.role === Role.MANAGER) {
    return { all: true };
  }
  if (user.role === Role.FOREMAN) {
    const assignments = await prisma.foremanSiteAssignment.findMany({
      where: { foremanId: user.id, unassignedAt: null },
      select: { siteId: true },
    });
    // Union: primary (if any) + every active assignment site, deduped.
    const siteIds = new Set<string>();
    if (user.primarySiteId) siteIds.add(user.primarySiteId);
    for (const a of assignments) siteIds.add(a.siteId);
    return { siteIds: [...siteIds] };
  }
  // PARTNER/WORKER must never reach a Foreman-scoped service.
  throw AppError.forbidden();
}

/**
 * Effective site FILTER for a scoped list/read (ASYNC). Returns the set of site ids
 * a query must be constrained to, or `{ all: true }` (no site filter):
 *   - ADMIN/MANAGER + no requested siteId → { all: true }.
 *   - ADMIN/MANAGER + requested siteId    → { siteIds: [requested] } (trusted).
 *   - FOREMAN + requested siteId → the id MUST be inside their union, else 403;
 *     returns { siteIds: [requested] } (a single-site view within their scope).
 *   - FOREMAN + no requested siteId → { siteIds: [union] } (the WHOLE scope; list
 *     endpoints filter to `siteId IN union`, NOT a single site).
 *   - FOREMAN with an EMPTY union → 403 (nothing to see; fail-closed).
 *
 * This is the multi-site replacement for the old single-`siteId` helper: a Foreman is
 * no longer collapsed to one default site; with no explicit siteId they see their
 * entire union.
 */
export async function effectiveSiteScope(
  user: AuthUser,
  requestedSiteId: string | undefined,
): Promise<SiteScope> {
  const scope = await resolveSiteScope(user);
  if ('all' in scope) {
    // ADMIN/MANAGER: trusted as-is. A requested site narrows; none = all sites.
    return requestedSiteId !== undefined ? { siteIds: [requestedSiteId] } : { all: true };
  }
  // FOREMAN.
  if (scope.siteIds.length === 0) {
    // Empty union → nothing they may see. Fail closed.
    throw AppError.forbidden();
  }
  if (requestedSiteId !== undefined) {
    if (!scope.siteIds.includes(requestedSiteId)) {
      // Cross-site probe (?siteId=<not-in-union>) → 403, never trusted.
      throw AppError.forbidden();
    }
    return { siteIds: [requestedSiteId] };
  }
  // No siteId supplied → the whole union.
  return { siteIds: scope.siteIds };
}

/**
 * Resolve a SINGLE effective site id for a caller (ASYNC) — for WRITE paths that must
 * stamp one concrete site (e.g. attendance record.siteId). Semantics:
 *   - ADMIN/MANAGER: pass the requested siteId through (may be undefined = caller's
 *     choice; the write path decides what undefined means for them).
 *   - FOREMAN + requested siteId: must be in their union, else 403 → returns it.
 *   - FOREMAN + no requested siteId:
 *       · exactly one site in union → that site id.
 *       · empty union               → 403 (nothing to default to).
 *       · MORE THAN ONE site        → 403: the write is ambiguous, the Foreman MUST
 *         name which of their sites the record belongs to (never silently pick one).
 *
 * A Foreman never gets `undefined`; a Foreman only ever gets a site inside their union.
 */
export async function effectiveSiteId(
  user: AuthUser,
  requestedSiteId: string | undefined,
): Promise<string | undefined> {
  const scope = await resolveSiteScope(user);
  if ('all' in scope) {
    return requestedSiteId; // ADMIN/MANAGER: trusted as-is (may be undefined = all).
  }
  // FOREMAN.
  if (scope.siteIds.length === 0) {
    throw AppError.forbidden(); // No site configured. Fail closed.
  }
  if (requestedSiteId !== undefined) {
    if (!scope.siteIds.includes(requestedSiteId)) {
      throw AppError.forbidden(); // Cross-site probe.
    }
    return requestedSiteId;
  }
  // No siteId supplied. A single-site foreman defaults to that site; a multi-site
  // foreman must disambiguate for a WRITE — refuse rather than guess (fail-closed).
  if (scope.siteIds.length === 1) return scope.siteIds[0];
  throw AppError.forbidden();
}

/**
 * Assert that a given worker is assigned to a site the caller may act on (ASYNC).
 * ADMIN/MANAGER: always allowed. FOREMAN: the worker must have a non-unassigned
 * SiteAssignment to one of the Foreman's UNION sites; otherwise 403 (no cross-site
 * write). A worker on ANY of the foreman's union sites is in scope.
 *
 * Uses SiteAssignment (worker↔site) — the same relation Manager attendance/dashboard
 * use to scope by site. Only ACTIVE assignments (unassignedAt = null) count.
 */
export async function assertWorkerInScope(
  user: AuthUser,
  workerId: string,
): Promise<void> {
  const scope = await resolveSiteScope(user);
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
    // Worker is not on any of the Foreman's sites → terse 403, no row detail leaked.
    throw AppError.forbidden();
  }
}
