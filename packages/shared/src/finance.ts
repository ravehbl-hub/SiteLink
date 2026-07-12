/**
 * @sitelink/shared — Financial ledgers: Loans, Advance Payments, and P&L
 * (PRD §5.3 FR-MGR-LOAN, §5.4 FR-MGR-ADV, §5.7 FR-MGR-PNL). v1-active.
 */
import type { ID, ISODate, Timestamped } from './common';

/** A loan recorded for a worker (FR-MGR-LOAN-1). */
export interface Loan extends Timestamped {
  id: ID;
  workerId: ID;
  amount: number;
  currency: string;
  date: ISODate;
  notes?: string | null;
  /** Outstanding amount not yet repaid; contributes to dashboard rollups (FR-MGR-LOAN-3). */
  outstanding: number;
}

/** An advance payment recorded for a worker (FR-MGR-ADV-1). */
export interface AdvancePayment extends Timestamped {
  id: ID;
  workerId: ID;
  amount: number;
  currency: string;
  date: ISODate;
  notes?: string | null;
  /** Outstanding amount not yet reconciled; feeds finance/workforce rollup (FR-MGR-ADV-3). */
  outstanding: number;
}

export interface CreateLoanInput {
  workerId: ID;
  amount: number;
  currency: string;
  date: ISODate;
  notes?: string | null;
}
export type UpdateLoanInput = Partial<Omit<CreateLoanInput, 'workerId'>>;

export interface CreateAdvanceInput {
  workerId: ID;
  amount: number;
  currency: string;
  date: ISODate;
  notes?: string | null;
}
export type UpdateAdvanceInput = Partial<Omit<CreateAdvanceInput, 'workerId'>>;

/**
 * Profit & Loss snapshot scoped by site + date range (FR-MGR-PNL-1/2).
 * Cost inputs derive from salary cost, loans, advances; revenue sourced per
 * data model (PRD A-3 — exact revenue source refined by Architecture).
 * May be computed on-demand or persisted as a periodic snapshot.
 */
export interface ProfitLoss extends Timestamped {
  id: ID;
  siteId?: ID | null;
  periodStart: ISODate;
  periodEnd: ISODate;
  currency: string;
  revenue: number;
  salaryCost: number;
  loansCost: number;
  advancesCost: number;
  otherCost: number;
  /** revenue - (salaryCost + loansCost + advancesCost + otherCost). */
  netProfit: number;
}
