/**
 * SiteLink back end — foreman-assignments service (Foreman multi-site).
 *
 * MANAGER/ADMIN assign/unassign a FOREMAN user to sites. These rows are the ASSIGNED
 * portion of a foreman's scope UNION (primarySiteId + active assignments) resolved in
 * lib/scope.ts. `@@unique([foremanId, siteId])` → reassigning a previously-unassigned
 * pair REACTIVATES the existing row (clears unassignedAt) rather than duplicating,
 * mirroring SiteAssignment's reactivate-in-place semantics.
 *
 * SECURITY / validation (nexo will probe):
 *   - The target user MUST exist AND be role FOREMAN (never assign a WORKER/MANAGER/
 *     ADMIN/PARTNER a foreman scope — that would silently grant site data access).
 *   - The target site MUST exist.
 *   - Guarding to MANAGER/ADMIN is done at the route (requireRole); this service is
 *     only reached by those roles.
 */
import { Role, SiteStatus } from '@sitelink/shared';
import type { ForemanSiteAssignment, PickableSite } from '@sitelink/shared';
import { prisma } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { toISO, toISORequired } from '../../lib/dates.js';
import {
  assertCompanyScopeMatch,
  resolveCompanyScope,
  resolveSiteScope,
  type CompanyScope,
} from '../../lib/scope.js';
import type { AuthUser } from '../../plugins/types.js';

type AssignmentRow = {
  id: string;
  siteId: string;
  foremanId: string;
  assignedAt: Date;
  unassignedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function mapAssignment(row: AssignmentRow): ForemanSiteAssignment {
  return {
    id: row.id,
    siteId: row.siteId,
    foremanId: row.foremanId,
    assignedAt: toISORequired(row.assignedAt),
    unassignedAt: toISO(row.unassignedAt),
    createdAt: toISORequired(row.createdAt),
    updatedAt: toISORequired(row.updatedAt),
  };
}

export class ForemanAssignmentsService {
  private companyScope(caller?: AuthUser): CompanyScope {
    return caller ? resolveCompanyScope(caller) : { allCompanies: true };
  }

  /**
   * Assign a foreman to a site (idempotent upsert). Validates the target is a FOREMAN
   * and the site exists. Reactivates a previously-unassigned pair; otherwise inserts.
   *
   * MULTI-TENANCY (P2, DERIVED MODEL): ForemanSiteAssignment has no companyId column —
   * its tenant derives from BOTH endpoints. We assert (a) the foreman AND the site are
   * each inside the CALLER's company (404 otherwise, no cross-tenant existence leak) and
   * (b) the foreman and the site are the SAME company (400 otherwise) — a foreman can
   * NEVER be assigned to another company's site.
   */
  async assign(
    input: { foremanId: string; siteId: string },
    caller?: AuthUser,
  ): Promise<ForemanSiteAssignment> {
    const foremanCompanyId = await this.ensureForeman(input.foremanId, caller);
    const siteCompanyId = await this.ensureSite(input.siteId, caller);
    if (foremanCompanyId !== siteCompanyId) {
      throw AppError.validation('Foreman and site belong to different companies');
    }

    const existing = await prisma.foremanSiteAssignment.findUnique({
      where: { foremanId_siteId: { foremanId: input.foremanId, siteId: input.siteId } },
    });

    if (existing) {
      // Reactivate-in-place: clear unassignedAt (no-op if already active).
      const row = await prisma.foremanSiteAssignment.update({
        where: { id: existing.id },
        data: { unassignedAt: null },
      });
      return mapAssignment(row);
    }

    const row = await prisma.foremanSiteAssignment.create({
      data: { foremanId: input.foremanId, siteId: input.siteId },
    });
    return mapAssignment(row);
  }

  /**
   * Unassign a foreman from a site: set unassignedAt = now for the ACTIVE pair. A
   * missing or already-unassigned pair → 404 (nothing active to end). Removing the
   * assignment removes that site from the foreman's scope union (fail-closed).
   */
  async unassign(
    input: { foremanId: string; siteId: string },
    caller?: AuthUser,
  ): Promise<ForemanSiteAssignment> {
    // P2: both endpoints must be in the caller's company (404 otherwise) before touch.
    await this.ensureForeman(input.foremanId, caller);
    await this.ensureSite(input.siteId, caller);
    const existing = await prisma.foremanSiteAssignment.findUnique({
      where: { foremanId_siteId: { foremanId: input.foremanId, siteId: input.siteId } },
    });
    if (!existing || existing.unassignedAt !== null) {
      throw AppError.notFound('No active assignment for this foreman/site');
    }
    const row = await prisma.foremanSiteAssignment.update({
      where: { id: existing.id },
      data: { unassignedAt: new Date() },
    });
    return mapAssignment(row);
  }

  /** List a foreman's ACTIVE assignments (unassignedAt = null). */
  async listForForeman(foremanId: string, caller?: AuthUser): Promise<ForemanSiteAssignment[]> {
    // P2: a manager can only list a foreman in their OWN company (404 otherwise).
    await this.ensureForeman(foremanId, caller);
    const rows = await prisma.foremanSiteAssignment.findMany({
      where: { foremanId, unassignedAt: null },
      orderBy: { assignedAt: 'desc' },
    });
    return rows.map(mapAssignment);
  }

  /**
   * SELF-scoped pickable sites for the CALLER foreman (GET /foreman-sites source).
   *
   * SECURITY: the union is derived ONLY from `caller` (req.appUser) via the SHARED
   * resolveSiteScope — the same helper the enforcement path uses — so it can never
   * include a site the foreman is not primary-on or actively assigned to, and a
   * client-supplied foremanId is never trusted (there is none). ADMIN/MANAGER resolve
   * to { all: true } here; this surface is FOREMAN-only at the route, so in practice
   * `caller` is a FOREMAN and we get a concrete (possibly empty) siteId union.
   *
   * Empty union → [] (200), NOT 403: the picker renders the no-site state. We then
   * join the union siteIds to Site rows for names/status and flag the primary entry.
   */
  async pickableSitesFor(caller: AuthUser): Promise<PickableSite[]> {
    const scope = await resolveSiteScope(caller);
    // ADMIN/MANAGER (unscoped) have no foreman union; this self surface returns nothing
    // meaningful for them. FOREMAN gets their concrete union (possibly empty).
    if ('all' in scope) return [];
    if (scope.siteIds.length === 0) return [];

    const sites = await prisma.site.findMany({
      where: { id: { in: scope.siteIds } },
      select: { id: true, name: true, status: true },
      orderBy: { name: 'asc' },
    });

    return sites.map((s) => ({
      siteId: s.id,
      name: s.name,
      isPrimary: caller.primarySiteId === s.id,
      status: s.status as SiteStatus,
    }));
  }

  private async ensureForeman(foremanId: string, caller?: AuthUser): Promise<string> {
    const user = await prisma.user.findUnique({
      where: { id: foremanId },
      select: { id: true, role: true, companyId: true },
    });
    // P2: cross-company foreman → 404 (no existence leak) before the role check.
    assertCompanyScopeMatch(this.companyScope(caller), user?.companyId);
    if (!user) throw AppError.notFound('Foreman user not found');
    if (user.role !== Role.FOREMAN) {
      // Only FOREMAN users may hold a foreman site scope. Refuse anything else.
      throw AppError.validation('Target user is not a FOREMAN');
    }
    return user.companyId;
  }

  private async ensureSite(siteId: string, caller?: AuthUser): Promise<string> {
    const site = await prisma.site.findUnique({
      where: { id: siteId },
      select: { id: true, companyId: true },
    });
    assertCompanyScopeMatch(this.companyScope(caller), site?.companyId);
    if (!site) throw AppError.notFound('Site not found');
    return site.companyId;
  }
}
