/**
 * SiteLink back end — salary module Zod schemas (FR-MGR-SRE / FR-MGR-PAY).
 *
 * NOTE: the request carries workerId + period only. The calc MODE and rate are
 * resolved server-side from stored config (ProfessionWageRate / WorkerSalaryData),
 * never taken from the client (FR-MGR-SRE-3).
 */
import { z } from 'zod';

export const calculateSalarySchema = z.object({
  workerId: z.string().min(1),
  siteId: z.string().optional(),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
});
