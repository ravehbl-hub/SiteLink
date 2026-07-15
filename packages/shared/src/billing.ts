/**
 * @sitelink/shared — SaaS business layer: Customers, Billing, Usage, P&L
 * (PRD §10 FR-BO). A "Customer" here is SiteLink's own SaaS customer (the
 * operating business's tenant/account), NOT a construction-site worker.
 *
 * These are the wire contracts for the ADMIN-only Back Office endpoints
 * (/backoffice/customers, /backoffice/billing, /backoffice/usage). Interfaces
 * align field-for-field with the Prisma models (Decimal → number, Date → ISO).
 */
import { z } from 'zod';
import type { Archivable, ID, ISODate, Timestamped } from './common';
import { BillingStatus } from './enums';

/** A SaaS customer / tenant account (FR-BO-1/2). Soft-deletable (Archivable). */
export interface Customer extends Timestamped, Archivable {
  id: ID;
  name: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  /** When the customer registered / left (FR-BO-1). */
  registeredAt: ISODate;
  leftAt?: ISODate | null;
}

/** Billing record for a customer (FR-BO-2). No real payment provider in v1. */
export interface Billing extends Timestamped {
  id: ID;
  customerId: ID;
  status: BillingStatus;
  plan: string;
  amount: number;
  currency: string;
  periodStart: ISODate;
  periodEnd: ISODate;
}

/** Usage metering per customer (FR-BO-2 / FR-BO-3). */
export interface Usage extends Timestamped {
  id: ID;
  customerId: ID;
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
  customerId?: ID | null;
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

/** POST /backoffice/customers */
export const createCustomerSchema = z.object({
  name: z.string().min(1),
  contactEmail: z.string().email().nullish(),
  contactPhone: z.string().min(1).nullish(),
  registeredAt: z.string().datetime().nullish(),
});
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

/** PATCH /backoffice/customers/:id */
export const updateCustomerSchema = z.object({
  name: z.string().min(1).optional(),
  contactEmail: z.string().email().nullish(),
  contactPhone: z.string().min(1).nullish(),
  registeredAt: z.string().datetime().optional(),
  leftAt: z.string().datetime().nullish(),
});
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

/** POST /backoffice/billing */
export const createBillingSchema = z.object({
  customerId: z.string().min(1),
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
  customerId: z.string().min(1),
  metric: z.string().min(1),
  value: z.number(),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
});
export type CreateUsageInput = z.infer<typeof createUsageSchema>;
