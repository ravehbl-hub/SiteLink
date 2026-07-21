/**
 * SiteLink back end — employee-mobility module Zod schemas.
 *
 * A "transfer" moves an employee to another site: it ADDS the destination site to
 * the worker's assignments (existing sites are kept — the worker may split time) and
 * re-points the effective-day PRESENCE (attendance) record to the destination site,
 * creating an ATTENDANCE record for that day if none exists.
 */
import { z } from 'zod';

export const transferSchema = z.object({
  workerId: z.string().min(1),
  // Destination site the worker is moving TO. Must be in the worker's company.
  toSiteId: z.string().min(1),
  // Effective date of the move — the presence (attendance) record for this worker/day
  // is re-pointed to the destination site (created on it if absent). Date-only in effect
  // (AttendanceRecord.date is @db.Date); a time component is ignored by the DB.
  date: z.string().datetime(),
  // Informational only: the site the worker is moving FROM (shown/audited in notes).
  // NOT acted upon — "add destination" semantics keep every existing assignment.
  fromSiteId: z.string().nullish(),
  notes: z.string().nullish(),
});

/** POST /mobility/unassign — remove a worker from a single site (hard unassign). */
export const removeFromSiteSchema = z.object({
  workerId: z.string().min(1),
  siteId: z.string().min(1),
});
