/**
 * SiteLink back end — employee-mobility service.
 *
 * transfer(): move an employee to another site. Semantics (product-approved):
 *   • ADD DESTINATION — upsert a SiteAssignment(worker, toSite); the worker's existing
 *     site assignments are KEPT (a worker may split time across sites).
 *   • UPDATE PRESENCE — re-point the effective-day AttendanceRecord to the destination
 *     site; if the worker has NO record for that day, CREATE an ATTENDANCE record on the
 *     destination site (hours left null — the manager records real hours separately).
 *
 * Everything runs in ONE transaction and is company-scoped: a cross-company worker or a
 * destination site in another tenant → 404 (no cross-tenant existence leak).
 */
import type { z } from 'zod';
import { AttendanceType, type AttendanceRecord } from '@sitelink/shared';
import { prisma } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { mapAttendance } from '../../lib/mappers.js';
import { assertCompanyScopeMatch, resolveCompanyScope, type CompanyScope } from '../../lib/scope.js';
import { Role } from '@sitelink/shared';
import type { AuthUser } from '../../plugins/types.js';
import type { transferSchema } from './schemas.js';

type TransferInput = z.infer<typeof transferSchema>;

export interface TransferResult {
  workerId: string;
  toSiteId: string;
  /** The presence record after the move (re-pointed existing, or freshly created). */
  attendance: AttendanceRecord;
  /** true when a new ATTENDANCE record was created because the worker had none that day. */
  presenceCreated: boolean;
}

export class MobilityService {
  private companyScope(caller?: AuthUser): CompanyScope {
    return caller ? resolveCompanyScope(caller) : { allCompanies: true };
  }

  /**
   * A destination site must belong to the SAME company as the worker — never a
   * cross-tenant site FK. Cross-company or nonexistent → 404 (no existence leak).
   */
  private async assertSiteInCompany(siteId: string, companyId: string): Promise<void> {
    const site = await prisma.site.findUnique({
      where: { id: siteId },
      select: { companyId: true },
    });
    if (!site || site.companyId !== companyId) {
      throw AppError.notFound('Site not found');
    }
  }

  async transfer(input: TransferInput, caller?: AuthUser): Promise<TransferResult> {
    // Load the worker's company; a cross-company workerId → 404 BEFORE any write. The
    // presence record's companyId is STAMPED from the worker, never the client.
    const worker = await prisma.worker.findUnique({
      where: { id: input.workerId },
      select: { companyId: true },
    });
    assertCompanyScopeMatch(this.companyScope(caller), worker?.companyId);
    if (!worker) throw AppError.notFound('Worker not found');
    const companyId = worker.companyId;

    // Destination site must be in the worker's company (404 otherwise).
    await this.assertSiteInCompany(input.toSiteId, companyId);

    // Effective day (AttendanceRecord.date is @db.Date — the DB truncates any time).
    const date = new Date(input.date);

    const { record, created } = await prisma.$transaction(async (tx) => {
      // 1) ADD DESTINATION — keep every existing assignment; (re)activate the target.
      await tx.siteAssignment.upsert({
        where: { siteId_workerId: { siteId: input.toSiteId, workerId: input.workerId } },
        create: { siteId: input.toSiteId, workerId: input.workerId },
        update: { unassignedAt: null },
      });

      // 2) UPDATE PRESENCE — re-point the effective-day record, or create one.
      const existing = await tx.attendanceRecord.findUnique({
        where: { workerId_date: { workerId: input.workerId, date } },
      });
      if (existing) {
        const updated = await tx.attendanceRecord.update({
          where: { id: existing.id },
          data: { siteId: input.toSiteId },
        });
        return { record: updated, created: false };
      }
      const createdRow = await tx.attendanceRecord.create({
        data: {
          workerId: input.workerId,
          companyId,
          siteId: input.toSiteId,
          date,
          type: AttendanceType.ATTENDANCE,
          hours: null,
          notes: input.notes ?? null,
        },
      });
      return { record: createdRow, created: true };
    });

    return {
      workerId: input.workerId,
      toSiteId: input.toSiteId,
      attendance: mapAttendance(record),
      presenceCreated: created,
    };
  }
}

// Role gate for the routes layer (ADMIN/MANAGER); re-exported for symmetry with siblings.
export const MOBILITY_ROLES: Role[] = [Role.ADMIN, Role.MANAGER];
