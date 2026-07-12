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

export class AttendanceService {
  async list(query: ListQuery): Promise<Paginated<AttendanceRecord>> {
    const where = {
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

  async create(input: CreateInput): Promise<AttendanceRecord> {
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

  async update(id: string, input: UpdateInput): Promise<AttendanceRecord> {
    const current = await prisma.attendanceRecord.findUnique({ where: { id } });
    if (!current) throw AppError.notFound('Attendance record not found');
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

  async remove(id: string): Promise<void> {
    const current = await prisma.attendanceRecord.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!current) throw AppError.notFound('Attendance record not found');
    await prisma.attendanceRecord.delete({ where: { id } });
  }

  /** Derived Working Hours aggregate, bucketed by day/week/month (FR-MGR-ATT-2). */
  async workingHours(query: HoursQuery): Promise<WorkingHours[]> {
    const rows = await prisma.attendanceRecord.findMany({
      where: {
        ...(query.workerId ? { workerId: query.workerId } : {}),
        ...(query.siteId ? { siteId: query.siteId } : {}),
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
