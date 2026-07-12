/**
 * @sitelink/shared — SaaS business layer: Customers, Billing, Usage, P&L
 * (PRD §10 FR-BO). FUTURE / OUT OF SCOPE v1 — modeled so no migration is
 * needed later. No Back Office UI is built in v1.
 */
import type { Archivable, ID, ISODate, Timestamped } from './common';
import { BillingStatus } from './enums';

/** A SaaS customer / tenant account (FR-BO-2). */
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
 * Back-Office P&L statement input at the SaaS-business level (FR-BO-4).
 * Distinct from the site-level ProfitLoss in finance.ts (which is Manager-facing).
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
