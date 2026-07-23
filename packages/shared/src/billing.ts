/**
 * @sitelink/shared — SaaS business layer: Billing, Usage, P&L (PRD §10 FR-BO).
 *
 * The billing SUBJECT is the tenant Company (the former standalone `Customer` model
 * was MERGED into Company — Option C). These are the wire contracts for the ADMIN-only
 * Back Office endpoints (/backoffice/billing, /backoffice/usage), keyed by companyId.
 * Interfaces align field-for-field with the Prisma models (Decimal → number, Date → ISO).
 */
import { z } from 'zod';
import type { ID, ISODate, Timestamped } from './common';
import { BillingStatus } from './enums';

/** Billing record for a company (FR-BO-2). No real payment provider in v1. */
export interface Billing extends Timestamped {
  id: ID;
  companyId: ID;
  status: BillingStatus;
  plan: string;
  amount: number;
  currency: string;
  periodStart: ISODate;
  periodEnd: ISODate;
}

/** Usage metering per company (FR-BO-2 / FR-BO-3). */
export interface Usage extends Timestamped {
  id: ID;
  companyId: ID;
  /** Metric key, e.g. "active_workers", "api_calls". */
  metric: string;
  value: number;
  periodStart: ISODate;
  periodEnd: ISODate;
}

/**
 * Back-Office P&L statement at the SaaS-business level (FR-BO-4). Distinct from
 * the site-level ProfitLoss in finance.ts (which is Manager-facing).
 */
export interface BusinessProfitLoss extends Timestamped {
  id: ID;
  companyId: ID;
  periodStart: ISODate;
  periodEnd: ISODate;
  currency: string;
  revenue: number;
  cost: number;
  netProfit: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Zod input contracts — validated at the route edge (ADMIN-only Back Office).
// ISO date-time strings on the wire; the back end normalises to Date columns.
// ─────────────────────────────────────────────────────────────────────────────

/** POST /backoffice/billing */
export const createBillingSchema = z.object({
  companyId: z.string().min(1),
  status: z.nativeEnum(BillingStatus).default(BillingStatus.TRIALING),
  plan: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().min(1).default('ILS'),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
});
export type CreateBillingInput = z.infer<typeof createBillingSchema>;

/** POST /backoffice/usage */
export const createUsageSchema = z.object({
  companyId: z.string().min(1),
  metric: z.string().min(1),
  value: z.number(),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
});
export type CreateUsageInput = z.infer<typeof createUsageSchema>;
