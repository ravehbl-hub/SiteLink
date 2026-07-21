/**
 * SiteLink back end — salary module Zod schemas (FR-MGR-SRE / FR-MGR-PAY).
 *
 * NOTE: the request carries workerId + period only. The calc MODE and rate are
 * resolved server-side from stored config (ProfessionWageRate / WorkerSalaryData),
 * never taken from the client (FR-MGR-SRE-3).
 */
import { z } from 'zod';

/** Default hours threshold for the HOURS-SPLIT payment mode (editable per-calc). */
export const DEFAULT_SPLIT_THRESHOLD = 236;

export const calculateSalarySchema = z
  .object({
    workerId: z.string().min(1),
    siteId: z.string().optional(),
    periodStart: z.string().datetime(),
    periodEnd: z.string().datetime(),
    /**
     * HOURS-SPLIT PAYMENT (optional, request-time — the manager toggles it per
     * calc). Default OFF → the calc is UNCHANGED (existing flat/hourly gross).
     * When ENABLED, attendance hours split at `splitThreshold`: the ≤threshold
     * portion pays the personnel (resolved) rate, the over-threshold remainder
     * pays `contractorRate`. `contractorRate` is REQUIRED when splitEnabled
     * (else 400) and is never persisted.
     */
    splitEnabled: z.boolean().optional().default(false),
    splitThreshold: z.number().positive().optional().default(DEFAULT_SPLIT_THRESHOLD),
    contractorRate: z.number().min(0).optional(),
  })
  .refine((v) => !v.splitEnabled || typeof v.contractorRate === 'number', {
    message: 'contractorRate is required when splitEnabled is true',
    path: ['contractorRate'],
  });
