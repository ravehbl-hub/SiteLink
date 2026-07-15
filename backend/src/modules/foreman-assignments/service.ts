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
import { Role } from '@sitelink/shared';
import type { ForemanSiteAssignment } from '@sitelink/shared';
import { prisma } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { toISO, toISORequired } from '../../lib/dates.js';

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
  /**
   * Assign a foreman to a site (idempotent upsert). Validates the target is a FOREMAN
   * and the site exists. Reactivates a previously-unassigned pair; otherwise inserts.
   */
  async assign(input: { foremanId: string; siteId: string }): Promise<ForemanSiteAssignment> {
    await this.ensureForeman(input.foremanId);
    await this.ensureSite(input.siteId);

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
  async unassign(input: { foremanId: string; siteId: string }): Promise<ForemanSiteAssignment> {
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
  async listForForeman(foremanId: string): Promise<ForemanSiteAssignment[]> {
    await this.ensureForeman(foremanId);
    const rows = await prisma.foremanSiteAssignment.findMany({
      where: { foremanId, unassignedAt: null },
      orderBy: { assignedAt: 'desc' },
    });
    return rows.map(mapAssignment);
  }

  private async ensureForeman(foremanId: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: foremanId },
      select: { id: true, role: true },
    });
    if (!user) throw AppError.notFound('Foreman user not found');
    if (user.role !== Role.FOREMAN) {
      // Only FOREMAN users may hold a foreman site scope. Refuse anything else.
      throw AppError.validation('Target user is not a FOREMAN');
    }
  }

  private async ensureSite(siteId: string): Promise<void> {
    const site = await prisma.site.findUnique({ where: { id: siteId }, select: { id: true } });
    if (!site) throw AppError.notFound('Site not found');
  }
}
