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
  /**
   * Clock-in / clock-out timestamps (ISO). The FE combines the record's date with the
   * entered time. Presence/display only — manual `hours` remains the source of truth for pay.
   */
  checkIn?: ISODate | null;
  checkOut?: ISODate | null;
  /** Hours worked on this date when type === ATTENDANCE (feeds salary + rollups). */
  hours?: number | null;
  notes?: string | null;
  /**
   * Back-link to the WorkerRequest whose approval created this record (VACATION effect).
   * Null for manually-created attendance; set only on approval-created rows, enabling
   * safe reversal on re-decide. Read-only tag owned by the request-approval flow.
   */
  requestId?: ID | null;
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
  /**
   * Clock-in / clock-out for this bucket, display-only (FR-WRK-1 in/out). Populated ONLY
   * when the bucket derives from a SINGLE attendance record — i.e. DAY grain, one record
   * per worker/site/day. For WEEK/MONTH grain (multiple records per bucket) these stay
   * null: there is no single meaningful check-in/out across a multi-day span.
   */
  checkIn?: ISODate | null;
  checkOut?: ISODate | null;
}

export interface CreateAttendanceInput {
  workerId: ID;
  siteId?: ID | null;
  date: ISODate;
  type: AttendanceType;
  checkIn?: ISODate | null;
  checkOut?: ISODate | null;
  hours?: number | null;
  notes?: string | null;
}

export type UpdateAttendanceInput = Partial<Omit<CreateAttendanceInput, 'workerId'>>;
