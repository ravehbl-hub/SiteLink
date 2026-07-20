/**
 * SiteLink back end — finance module Zod schemas (FR-MGR-LOAN/ADV/PNL).
 */
import { z } from 'zod';

export const createLoanSchema = z.object({
  workerId: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().default('ILS'),
  date: z.string().datetime(),
  notes: z.string().nullish(),
  /** Optional starting outstanding; defaults to the full amount. */
  outstanding: z.number().nonnegative().optional(),
});

export const updateLoanSchema = z.object({
  amount: z.number().positive().optional(),
  currency: z.string().optional(),
  date: z.string().datetime().optional(),
  notes: z.string().nullish(),
  outstanding: z.number().nonnegative().optional(),
});

// Advances share the same wire shape as loans.
export const createAdvanceSchema = createLoanSchema;
export const updateAdvanceSchema = updateLoanSchema;

export const listByWorkerQuery = z.object({
  workerId: z.string().optional(),
  // MULTI-TENANCY (P2): ADMIN read-narrow; IGNORED for a non-admin.
  companyId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const profitLossQuery = z.object({
  siteId: z.string().optional(),
  companyId: z.string().optional(),
  from: z.string().datetime(),
  to: z.string().datetime(),
  /** Revenue is a manual per-site input (PRD A-3 assumption). */
  revenue: z.coerce.number().nonnegative().default(0),
  currency: z.string().default('ILS'),
});

export const idParam = z.object({ id: z.string().min(1) });
