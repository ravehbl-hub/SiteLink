/**
 * SiteLink back end — attendance module Zod schemas (FR-MGR-ATT).
 */
import { z } from 'zod';
import { AttendanceType } from '@sitelink/shared';

export const createAttendanceSchema = z.object({
  workerId: z.string().min(1),
  siteId: z.string().nullish(),
  date: z.string().datetime(),
  type: z.nativeEnum(AttendanceType),
  // Clock IN/OUT — optional nullable ISO datetime (FE combines record date + entered time).
  checkIn: z.string().datetime().nullish(),
  checkOut: z.string().datetime().nullish(),
  hours: z.number().nonnegative().nullish(),
  notes: z.string().nullish(),
});

export const updateAttendanceSchema = z.object({
  siteId: z.string().nullish(),
  date: z.string().datetime().optional(),
  type: z.nativeEnum(AttendanceType).optional(),
  checkIn: z.string().datetime().nullish(),
  checkOut: z.string().datetime().nullish(),
  hours: z.number().nonnegative().nullish(),
  notes: z.string().nullish(),
});

export const listAttendanceQuery = z.object({
  workerId: z.string().optional(),
  siteId: z.string().optional(),
  // MULTI-TENANCY (P2): ADMIN read-narrow; IGNORED for a non-admin.
  companyId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
});

export const workingHoursQuery = z.object({
  workerId: z.string().optional(),
  siteId: z.string().optional(),
  companyId: z.string().optional(),
  from: z.string().datetime(),
  to: z.string().datetime(),
  grain: z.enum(['DAY', 'WEEK', 'MONTH']).default('DAY'),
});

export const idParam = z.object({ id: z.string().min(1) });
