/**
 * @sitelink/shared — Attendance / Vacation / Disease & Working Hours (PRD §5.5 FR-MGR-ATT). v1-active.
 */
import type { ID, ISODate, Timestamped } from './common';
import { AttendanceType } from './enums';

/**
 * A single attendance record for a worker on a date.
 * Status is exclusive per worker/day (FR-MGR-ATT-4): exactly one of
 * ATTENDANCE / VACATION / DISEASE — enforced by a unique (workerId, date) index.
 */
export interface AttendanceRecord extends Timestamped {
  id: ID;
  workerId: ID;
  /** Site the work/absence is attributed to (drives per-site rollups). */
  siteId?: ID | null;
  /** The day this record applies to. */
  date: ISODate;
  type: AttendanceType;
  /** Hours worked on this date when type === ATTENDANCE (feeds salary + rollups). */
  hours?: number | null;
  notes?: string | null;
}

/** Aggregation grain for derived Working Hours views (FR-MGR-ATT-2). */
export type WorkingHoursGrain = 'DAY' | 'WEEK' | 'MONTH';

/**
 * Derived Working Hours aggregate (FR-MGR-ATT-2/3).
 * Computed from AttendanceRecord; not necessarily persisted (may be a view/rollup).
 */
export interface WorkingHours {
  workerId: ID;
  siteId?: ID | null;
  grain: WorkingHoursGrain;
  /** Start of the aggregation bucket (inclusive). */
  periodStart: ISODate;
  /** End of the aggregation bucket (inclusive). */
  periodEnd: ISODate;
  totalHours: number;
  attendanceDays: number;
  vacationDays: number;
  diseaseDays: number;
}

export interface CreateAttendanceInput {
  workerId: ID;
  siteId?: ID | null;
  date: ISODate;
  type: AttendanceType;
  hours?: number | null;
  notes?: string | null;
}

export type UpdateAttendanceInput = Partial<Omit<CreateAttendanceInput, 'workerId'>>;
