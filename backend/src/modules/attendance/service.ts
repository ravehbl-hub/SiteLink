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
import { assertWorkerInScope, isForeman, isWorker, resolveWorkerId } from '../../lib/scope.js';
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
 * Prisma `where` fragment that HARD-scopes attendance rows to a FOREMAN's site.
 * ADMIN/MANAGER (or no caller) → `{}` (unscoped). A Foreman with no configured
 * primarySite → an impossible predicate so they see nothing (fail-closed).
 */
function foremanAttendanceScope(caller?: AuthUser): Record<string, unknown> {
  if (!caller || !isForeman(caller)) return {};
  if (!caller.primarySiteId) return { id: '__no_site_for_foreman__' };
  return {
    worker: {
      assignments: { some: { unassignedAt: null, siteId: caller.primarySiteId } },
    },
  };
}

export class AttendanceService {
  /**
   * List attendance. When `caller` is a FOREMAN the result is HARD-scoped to workers
   * on their site(s) via a `worker.assignments` filter — regardless of any client
   * ?workerId / ?siteId, which cannot widen the scope (a cross-site workerId simply
   * matches nothing). ADMIN/MANAGER (or no caller) are unscoped.
   */
  async list(query: ListQuery, caller?: AuthUser): Promise<Paginated<AttendanceRecord>> {
    const foremanScope = foremanAttendanceScope(caller);
    const where = {
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
    if (caller && isForeman(caller)) {
      await assertWorkerInScope(caller, input.workerId);
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
        siteId: input.siteId ?? null,
        date,
        type: input.type,
        hours: input.hours ?? null,
        notes: input.notes ?? null,
      },
    });
    return mapAttendance(row);
  }

  async update(id: string, input: UpdateInput, caller?: AuthUser): Promise<AttendanceRecord> {
    const current = await prisma.attendanceRecord.findUnique({ where: { id } });
    if (!current) throw AppError.notFound('Attendance record not found');
    // SECURITY: a FOREMAN may only edit records for workers on their site(s).
    if (caller && isForeman(caller)) {
      await assertWorkerInScope(caller, current.workerId);
    }
    const row = await prisma.attendanceRecord.update({
      where: { id },
      data: {
        ...(input.siteId !== undefined ? { siteId: input.siteId } : {}),
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
      select: { id: true, workerId: true },
    });
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

    const rows = await prisma.attendanceRecord.findMany({
      where: {
        ...foremanAttendanceScope(caller),
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
