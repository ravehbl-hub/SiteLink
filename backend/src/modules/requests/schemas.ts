/**
 * SiteLink back end — requests module Zod schemas (FR-REQ — modeled).
 */
import { z } from 'zod';
import { RequestStatus, RequestType } from '@sitelink/shared';

export const createRequestSchema = z.object({
  // Optional: REQUIRED for ADMIN/MANAGER (enforced in-handler). For a WORKER caller
  // it is IGNORED and forced to the caller's own resolved Worker id.
  workerId: z.string().min(1).optional(),
  type: z.nativeEnum(RequestType),
  amount: z.number().positive().nullish(),
  currency: z.string().nullish(),
  startDate: z.string().datetime().nullish(),
  endDate: z.string().datetime().nullish(),
  notes: z.string().nullish(),
});

export const resolveRequestSchema = z.object({
  status: z.enum([RequestStatus.APPROVED, RequestStatus.REJECTED]),
  resolutionNotes: z.string().nullish(),
});

export const listRequestsQuery = z.object({
  workerId: z.string().optional(),
  status: z.nativeEnum(RequestStatus).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const idParam = z.object({ id: z.string().min(1) });
