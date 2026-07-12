/**
 * @sitelink/shared — Manager Dashboard rollup (PRD §5.1 FR-MGR-DASH). v1-active.
 *
 * A single server-computed rollup object for a site/date filter, consumed by both
 * Manager front ends (web + app). The Dashboard defaults to an all-sites view
 * (FR-MGR-DASH-1) and is filterable by construction site + date range
 * (FR-MGR-DASH-2). Workforce + Finance metrics are rolled up consistently for the
 * same filter window (FR-MGR-DASH-3/4/5); an empty filter yields zeros, not an
 * error (FR-MGR-DASH-6).
 */
import type { ID, ISODate } from './common';
import type { ProfitLoss } from './finance';

/** The site/date filter the rollup was computed for (echoed back for the client). */
export interface DashboardFilter {
  /** Null = all-sites view (FR-MGR-DASH-1). */
  siteId?: ID | null;
  /** Inclusive start of the window. */
  from: ISODate;
  /** Inclusive end of the window. */
  to: ISODate;
}

/** Per-site worker headcount breakdown (FR-MGR-DASH-3 "workers per site"). */
export interface WorkersPerSite {
  siteId: ID;
  siteName: string;
  workerCount: number;
}

/** Workforce metrics for the filter window (FR-MGR-DASH-3). */
export interface WorkersRollup {
  /** Total active (non-archived) workers in scope. */
  amountOfWorkers: number;
  /** Attendance/vacation/disease day-counts across the range. */
  attendanceDays: number;
  vacationDays: number;
  diseaseDays: number;
  /** Aggregate worked hours across the range (reuses working-hours aggregation). */
  totalWorkHours: number;
  /** Headcount broken down per site. */
  workersPerSite: WorkersPerSite[];
  /** Sum of outstanding loans in scope. */
  loansTotal: number;
  /** Sum of outstanding advance payments in scope. */
  advancePaymentsTotal: number;
}

/** Finance metrics for the filter window (FR-MGR-DASH-4). */
export interface FinanceRollup {
  currency: string;
  /** Total salary cost — summed via the SalaryRuleEngine across workers in scope. */
  salaryTotal: number;
  /** P&L summary (revenue is MANUAL per-site input; costs from salary/loans/advances). */
  profitAndLoss: ProfitLoss;
}

/** The single Dashboard rollup response (FR-MGR-DASH). */
export interface DashboardRollup {
  filter: DashboardFilter;
  workers: WorkersRollup;
  finance: FinanceRollup;
  /** When the rollup was computed (server clock). */
  computedAt: ISODate;
}
