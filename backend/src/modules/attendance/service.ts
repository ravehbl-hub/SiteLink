/**
 * SiteLink back end — attendance service (FR-MGR-ATT).
 *
 * One record per worker per day (unique constraint enforces exclusivity among
 * ATTENDANCE / VACATION / DISEASE — FR-MGR-ATT-4). Working Hours aggregates
 * (day/week/month) are DERIVED from these rows at query time (FR-MGR-ATT-2).
 */
import type { z } from 'zod';
import type {
  AttendanceRecord,
  Paginated,
  WorkingHours,
  WorkingHoursGrain,
} from '@sitelink/shared';
import { AttendanceType } from '@sitelink/shared';
import { prisma } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { isoWeekKey, monthKey, toDateOnly, toISORequired } from '../../lib/dates.js';
import { mapAttendance } from '../../lib/mappers.js';
import { toNumber } from '../../lib/money.js';
import { paginate } from '../../lib/pagination.js';
import {
  assertCompanyScopeMatch,
  assertWorkerInScope,
  companyWhere,
  effectiveCompanyScope,
  effectiveSiteId,
  isForeman,
  isWorker,
  resolveCompanyScope,
  resolveSiteScope,
  resolveWorkerId,
  type CompanyScope,
} from '../../lib/scope.js';
import type { AuthUser } from '../../plugins/types.js';
import type {
  createAttendanceSchema,
  listAttendanceQuery,
  updateAttendanceSchema,
  workingHoursQuery,
} from './schemas.js';

type CreateInput = z.infer<typeof createAttendanceSchema>;
type UpdateInput = z.infer<typeof updateAttendanceSchema>;
type ListQuery = z.infer<typeof listAttendanceQuery>;
type HoursQuery = z.infer<typeof workingHoursQuery>;

/**
 * Prisma `where` fragment that HARD-scopes attendance rows to a FOREMAN's UNION of
 * sites (primarySiteId + active ForemanSiteAssignment sites). ADMIN/MANAGER (or no
 * caller) → `{}` (unscoped). A Foreman with an EMPTY union → an impossible predicate
 * so they see nothing (fail-closed). ASYNC now: the union needs a DB read.
 *
 * HARDENING (nexo-back Stage B): two constraints are applied for a FOREMAN caller —
 *   1. the WORKER must be assigned to one of the Foreman's union sites
 *      (worker.assignments), AND
 *   2. the RECORD's own `siteId` must be one of the Foreman's union sites (or NULL).
 * Constraint (2) closes the shared-worker cross-site leak: a worker assigned to both
 * a Foreman's site AND another (out-of-union) site would otherwise expose their
 * OTHER-site attendance rows to the Foreman. We now only return rows LOGGED AT a site
 * in the Foreman's union. `AttendanceRecord.siteId` is nullable; a NULL siteId means
 * legacy/unspecified and — since the worker is already confirmed on the Foreman's
 * union by (1) — is INCLUDED. Only a record whose siteId is explicitly some site
 * OUTSIDE the union is excluded.
 */
async function foremanAttendanceScope(caller?: AuthUser): Promise<Record<string, unknown>> {
  if (!caller || !isForeman(caller)) return {};
  const scope = await resolveSiteScope(caller);
  if ('all' in scope) return {}; // defensive: a foreman never resolves to `all`.
  if (scope.siteIds.length === 0) return { id: '__no_site_for_foreman__' };
  return {
    worker: {
      assignments: { some: { unassignedAt: null, siteId: { in: scope.siteIds } } },
    },
    OR: [{ siteId: { in: scope.siteIds } }, { siteId: null }],
  };
}

/**
 * Resolve the siteId a FOREMAN's attendance record must carry (data-integrity
 * hardening, nexo-back Stage B). Delegates to the shared `effectiveSiteId` scope
 * helper (ASYNC, multi-site): a supplied siteId NOT in the Foreman's union → 403; a
 * supplied siteId in their union → that site; no siteId supplied → their single
 * union site, or 403 if their union has MORE THAN ONE site (ambiguous write — the
 * Foreman must name which site). A Foreman with an empty union → 403 (fail-closed).
 * This mirrors "a foreman acts on their own site" — they can never stamp a site
 * outside their union.
 */
async function forceForemanSite(
  caller: AuthUser,
  requestedSiteId: string | null | undefined,
): Promise<string> {
  return (await effectiveSiteId(caller, requestedSiteId ?? undefined)) as string;
}

/**
 * MULTI-TENANCY (P2): a Prisma company-filter fragment for attendance rows. Non-admin
 * → their own company (client ?companyId ignored); ADMIN → unscoped, ?companyId narrows.
 * AttendanceRecord has a DIRECT companyId column (backfilled from Worker.companyId), so
 * the filter is a plain `{ companyId }`. ANDs with the foreman site scope.
 */
function attendanceCompanyWhere(
  caller: AuthUser | undefined,
  requestedCompanyId?: string,
): { companyId?: string } {
  if (!caller) return {};
  return companyWhere(effectiveCompanyScope(caller, requestedCompanyId));
}

export class AttendanceService {
  private companyScope(caller?: AuthUser): CompanyScope {
    return caller ? resolveCompanyScope(caller) : { allCompanies: true };
  }

  /**
   * TENANCY guard: a supplied `siteId` on an attendance write must belong to the SAME
   * company as the record (the worker's company). Prevents a manager crafting a
   * cross-tenant site FK in the request body. Cross-company or nonexistent site → 404
   * (never confirm another tenant's site existence).
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

  /**
   * List attendance. When `caller` is a FOREMAN the result is HARD-scoped to workers
   * on their site(s) via a `worker.assignments` filter — regardless of any client
   * ?workerId / ?siteId, which cannot widen the scope (a cross-site workerId simply
   * matches nothing). ADMIN/MANAGER (or no caller) are unscoped.
   */
  async list(query: ListQuery, caller?: AuthUser): Promise<Paginated<AttendanceRecord>> {
    const foremanScope = await foremanAttendanceScope(caller);
    const where = {
      ...attendanceCompanyWhere(caller, query.companyId),
      ...foremanScope,
      ...(query.workerId ? { workerId: query.workerId } : {}),
      ...(query.siteId ? { siteId: query.siteId } : {}),
      ...(query.from || query.to
        ? {
            date: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    const skip = (query.page - 1) * query.pageSize;
    const [rows, total] = await Promise.all([
      prisma.attendanceRecord.findMany({
        where,
        skip,
        take: query.pageSize,
        orderBy: { date: 'desc' },
      }),
      prisma.attendanceRecord.count({ where }),
    ]);
    return paginate(rows.map(mapAttendance), total, {
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  async create(input: CreateInput, caller?: AuthUser): Promise<AttendanceRecord> {
    // SECURITY: a FOREMAN may only create attendance for a worker on their site(s).
    // The record's siteId is then FORCED to the Foreman's own site (data-integrity
    // hardening, nexo-back Stage B): passing the workerId scope check must not let a
    // Foreman stamp the record with an ARBITRARY site.
    // MULTI-TENANCY (P2): load the worker's company; a cross-company workerId → 404
    // (no cross-tenant existence leak) BEFORE any site-scope or write. The new record's
    // companyId is STAMPED from the worker (worker.companyId), never the client.
    const worker = await prisma.worker.findUnique({
      where: { id: input.workerId },
      select: { companyId: true },
    });
    assertCompanyScopeMatch(this.companyScope(caller), worker?.companyId);
    if (!worker) throw AppError.notFound('Worker not found');
    const companyId = worker.companyId;

    let siteId = input.siteId ?? null;
    if (caller && isForeman(caller)) {
      await assertWorkerInScope(caller, input.workerId);
      siteId = await forceForemanSite(caller, input.siteId);
    } else if (siteId != null) {
      // TENANCY: a non-foreman (MANAGER) may only attach a site in the SAME company as
      // the record — never a cross-tenant site FK. Assert the supplied site's company
      // matches the record's (worker's) company; cross-company siteId → 404.
      await this.assertSiteInCompany(siteId, companyId);
    }
    // Clock IN/OUT (optional, nullable). Presence/display only — manual `hours` stays the
    // source of truth for pay. Light guard: if BOTH provided, checkOut must be after checkIn.
    const checkIn = input.checkIn != null ? new Date(input.checkIn) : null;
    const checkOut = input.checkOut != null ? new Date(input.checkOut) : null;
    if (checkIn && checkOut && checkOut.getTime() < checkIn.getTime()) {
      throw AppError.validation('checkOut must be after checkIn');
    }
    // Enforce exclusivity: reject a second record for the same worker/day.
    const date = new Date(input.date);
    const existing = await prisma.attendanceRecord.findUnique({
      where: { workerId_date: { workerId: input.workerId, date } },
    });
    if (existing) {
      throw AppError.conflict('An attendance record already exists for this worker/day');
    }
    const row = await prisma.attendanceRecord.create({
      data: {
        workerId: input.workerId,
        companyId,
        siteId,
        date,
        type: input.type,
        checkIn,
        checkOut,
        hours: input.hours ?? null,
        notes: input.notes ?? null,
      },
    });
    return mapAttendance(row);
  }

  async update(id: string, input: UpdateInput, caller?: AuthUser): Promise<AttendanceRecord> {
    const current = await prisma.attendanceRecord.findUnique({ where: { id } });
    // P2: cross-company record → 404 (no existence leak) before any mutation.
    assertCompanyScopeMatch(this.companyScope(caller), current?.companyId);
    if (!current) throw AppError.notFound('Attendance record not found');
    // SECURITY: a FOREMAN may only edit records for workers on their site(s), and
    // may only (re)stamp the record with THEIR OWN site — never an arbitrary one
    // (data-integrity hardening, nexo-back Stage B).
    let siteIdPatch: Record<string, unknown> =
      input.siteId !== undefined ? { siteId: input.siteId } : {};
    if (caller && isForeman(caller)) {
      await assertWorkerInScope(caller, current.workerId);
      // Force the record onto the Foreman's own site whenever siteId is supplied.
      if (input.siteId !== undefined) {
        siteIdPatch = { siteId: await forceForemanSite(caller, input.siteId) };
      }
    } else if (input.siteId != null) {
      // TENANCY: a non-foreman (MANAGER) may only re-point the record to a site in the
      // SAME company as the record — never a cross-tenant site FK. 404 on mismatch.
      await this.assertSiteInCompany(input.siteId, current.companyId);
    }
    // Clock IN/OUT patch (partial, nullable). Light guard: reject when the EFFECTIVE
    // (post-patch) pair has checkOut before checkIn. `undefined` = leave as-is.
    const checkInPatch =
      input.checkIn !== undefined
        ? { checkIn: input.checkIn != null ? new Date(input.checkIn) : null }
        : {};
    const checkOutPatch =
      input.checkOut !== undefined
        ? { checkOut: input.checkOut != null ? new Date(input.checkOut) : null }
        : {};
    const effIn =
      input.checkIn !== undefined
        ? input.checkIn != null
          ? new Date(input.checkIn)
          : null
        : current.checkIn;
    const effOut =
      input.checkOut !== undefined
        ? input.checkOut != null
          ? new Date(input.checkOut)
          : null
        : current.checkOut;
    if (effIn && effOut && effOut.getTime() < effIn.getTime()) {
      throw AppError.validation('checkOut must be after checkIn');
    }
    const row = await prisma.attendanceRecord.update({
      where: { id },
      data: {
        ...siteIdPatch,
        ...checkInPatch,
        ...checkOutPatch,
        ...(input.date !== undefined ? { date: new Date(input.date) } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.hours !== undefined ? { hours: input.hours } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    });
    return mapAttendance(row);
  }

  async remove(id: string, caller?: AuthUser): Promise<void> {
    const current = await prisma.attendanceRecord.findUnique({
      where: { id },
      select: { id: true, workerId: true, companyId: true },
    });
    // P2: cross-company record → 404 before any delete.
    assertCompanyScopeMatch(this.companyScope(caller), current?.companyId);
    if (!current) throw AppError.notFound('Attendance record not found');
    // SECURITY: a FOREMAN may only delete records for workers on their site(s).
    if (caller && isForeman(caller)) {
      await assertWorkerInScope(caller, current.workerId);
    }
    await prisma.attendanceRecord.delete({ where: { id } });
  }

  /** Derived Working Hours aggregate, bucketed by day/week/month (FR-MGR-ATT-2). */
  async workingHours(query: HoursQuery, caller?: AuthUser): Promise<WorkingHours[]> {
    // WORKER self-scope: FORCE the filter to the caller's OWN resolved Worker id,
    // ignoring any client-supplied ?workerId/?siteId. No linked worker → empty set
    // (fail-closed read). This branch never trusts the client for identity.
    let selfWorkerId: string | undefined;
    if (caller && isWorker(caller)) {
      const resolved = await resolveWorkerId(caller);
      if (!resolved) return [];
      selfWorkerId = resolved;
    }

    const foremanScope = await foremanAttendanceScope(caller);
    const rows = await prisma.attendanceRecord.findMany({
      where: {
        ...attendanceCompanyWhere(caller, query.companyId),
        ...foremanScope,
        ...(selfWorkerId
          ? { workerId: selfWorkerId }
          : query.workerId
            ? { workerId: query.workerId }
            : {}),
        ...(selfWorkerId ? {} : query.siteId ? { siteId: query.siteId } : {}),
        date: { gte: new Date(query.from), lte: new Date(query.to) },
      },
      orderBy: { date: 'asc' },
    });

    const grain = query.grain as WorkingHoursGrain;
    const bucketKey = (d: Date): string => {
      if (grain === 'DAY') return toDateOnly(d);
      if (grain === 'WEEK') return isoWeekKey(d);
      return monthKey(d);
    };

    const buckets = new Map<
      string,
      {
        workerId: string;
        siteId: string | null;
        totalHours: number;
        attendanceDays: number;
        vacationDays: number;
        diseaseDays: number;
        minDate: Date;
        maxDate: Date;
      }
    >();

    for (const r of rows) {
      // Group per worker+site+bucket so aggregates never mix workers.
      const key = `${r.workerId}|${r.siteId ?? ''}|${bucketKey(r.date)}`;
      const b =
        buckets.get(key) ??
        {
          workerId: r.workerId,
          siteId: r.siteId ?? null,
          totalHours: 0,
          attendanceDays: 0,
          vacationDays: 0,
          diseaseDays: 0,
          minDate: r.date,
          maxDate: r.date,
        };
      if (r.type === AttendanceType.ATTENDANCE) {
        b.attendanceDays += 1;
        b.totalHours += toNumber(r.hours);
      } else if (r.type === AttendanceType.VACATION) {
        b.vacationDays += 1;
      } else {
        b.diseaseDays += 1;
      }
      if (r.date < b.minDate) b.minDate = r.date;
      if (r.date > b.maxDate) b.maxDate = r.date;
      buckets.set(key, b);
    }

    return [...buckets.values()].map((b) => ({
      workerId: b.workerId,
      siteId: b.siteId,
      grain,
      periodStart: toISORequired(b.minDate),
      periodEnd: toISORequired(b.maxDate),
      totalHours: b.totalHours,
      attendanceDays: b.attendanceDays,
      vacationDays: b.vacationDays,
      diseaseDays: b.diseaseDays,
    }));
  }
}
