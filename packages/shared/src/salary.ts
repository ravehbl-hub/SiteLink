/**
 * @sitelink/shared — Compensation domain: profession wage rates + the
 * SalaryRuleEngine contract (PRD §11 FR-MGR-SRE, §5.6 FR-MGR-PAY). v1-active.
 *
 * The SalaryRuleEngine DTOs below mirror the PRD FR-MGR-SRE §11.1 contract shape
 * EXACTLY (field names and the wire literals 'israeli-labor-law' | 'fixed'), so the
 * back-end engine and all clients share one authority. Callers depend only on the
 * `SalaryRuleEngine` interface, never on a concrete strategy (FR-MGR-SRE-3).
 */
import type { ID, ISODate, Timestamped } from './common';
import { RateType, SalaryCalcMode } from './enums';

/* ────────────────────────────────────────────────────────────────────────
 * ProfessionWageRate — hourly wage by profession + calc mode (FR-MGR-PAY-1/2/3)
 * ──────────────────────────────────────────────────────────────────────── */

/** Wage rule keyed by profession, with the salary calculation mode to apply. */
export interface ProfessionWageRate extends Timestamped {
  id: ID;
  /**
   * MULTI-TENANCY (P2): the tenant this rate belongs to. READ-ONLY on the wire — the
   * server stamps it from the caller's own company; uniqueness is
   * @@unique([companyId, profession, siteId]). A worker only ever resolves a rate in
   * their OWN company. The FE never sends it.
   */
  companyId?: ID;
  /** Profession this rate applies to (matches Profession enum values). */
  profession: string;
  /** Hourly (or monthly) wage for the profession (FR-MGR-PAY-1). */
  wage: number;
  rateType: RateType;
  /** Persisted calc mode: ISRAELI_LABOR_LAW | FIXED (FR-MGR-PAY-2). */
  calcMode: SalaryCalcMode;
  currency: string;
  /** Optional site scope; null = applies globally. */
  siteId?: ID | null;
}

export interface CreateProfessionWageRateInput {
  profession: string;
  wage: number;
  rateType: RateType;
  calcMode: SalaryCalcMode;
  currency: string;
  siteId?: ID | null;
}

export type UpdateProfessionWageRateInput = Partial<CreateProfessionWageRateInput>;

/* ────────────────────────────────────────────────────────────────────────
 * SalaryRuleEngine — PRD FR-MGR-SRE §11.1 contract (authoritative wire shape)
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Salary calculation mode as used on the SalaryRuleEngine WIRE contract.
 * These exact literals are fixed by PRD FR-MGR-SRE §11.1 and MUST NOT change.
 * Persisted records use the SalaryCalcMode enum; map with the helpers below.
 */
export type SalaryMode = 'israeli-labor-law' | 'fixed';

/** Per-day hours entry, exactly as PRD §11.1 `hoursByDay[]`. */
export interface SalaryHoursByDay {
  date: ISODate;
  hours: number;
  status: 'attendance' | 'vacation' | 'disease';
}

/** SalaryRuleEngine input — PRD §11.1 `SalaryComputationInput`, verbatim shape. */
export interface SalaryInput {
  workerId: string;
  siteId?: string;
  periodStart: ISODate;
  periodEnd: ISODate;
  mode: SalaryMode;
  hoursByDay: SalaryHoursByDay[];
  /** Resolved rate (by worker or by profession). */
  hourlyWage: number;
  /** Used when mode === 'fixed'. */
  fixedSalary?: number;
  currency: string;
}

/** One breakdown line, as PRD §11.1 `breakdown[]`. */
export interface SalaryBreakdownLine {
  label: string;
  amount: number;
}

/** SalaryRuleEngine result — PRD §11.1 `SalaryResult`, verbatim shape. */
export interface SalaryResult {
  gross: number;
  breakdown: SalaryBreakdownLine[];
  currency: string;
  mode: SalaryMode;
  /**
   * The resolved hourly rate the calc used (the same `SalaryInput.hourlyWage`,
   * resolved per-worker or by profession). Exposed so clients can render the
   * rate + per-row line totals (hours × hourlyWage) that reconcile with `gross`.
   *
   * NOTE: for a fixed MONTHLY salary calc there is no per-hour rate driving the
   * total — `gross` is the fixed amount, not `hourlyWage × hours`. In that case
   * `hourlyWage` is informational (the resolved rate) and does NOT reconcile with
   * `gross`. For a flat hourly calc, `gross === attendanceHours × hourlyWage`.
   */
  hourlyWage: number;
  /** Includes a 'stub' marker in v1 (FR-MGR-SRE-4). */
  engineVersion: string;
  computedAt: ISODate;
  /**
   * NET WAGE (נטו) deductions + net — populated by the salary SERVICE (not the pure
   * engine), which reconciles GROSS against the worker's OWN-company APPROVED
   * loan/advance requests within the calc PERIOD (FR-MGR-PAY, defense-in-depth P2).
   *
   * Optional on the wire because the pure `SalaryRuleEngine.compute()` returns only
   * gross/breakdown; the service layer (SalaryService.calculate) adds these. Clients
   * that read them should treat absence as "not yet computed" (single-calc path only).
   *
   * - loansTotal    : Σ approved LOAN amounts, period + company scoped (≥ 0).
   * - advancesTotal : Σ approved ADVANCE amounts, period + company scoped (≥ 0).
   * - net           : gross − loansTotal − advancesTotal.
   *
   * NET CAN BE NEGATIVE. It is the REAL net and is NOT floored at 0 — if approved
   * loans/advances exceed gross the worker owes the company, and the number goes
   * below zero on purpose. FE/PDF display it as-is (flagging when negative).
   */
  loansTotal?: number;
  advancesTotal?: number;
  net?: number;
  /**
   * HOURS-SPLIT PAYMENT (optional, request-driven, Phase 2 company-scoped).
   *
   * When the manager ENABLES split mode for a single calc, the worker's total
   * ATTENDANCE hours are split at `threshold`:
   *   - Personnel portion = min(totalHours, threshold) × the resolved personnel
   *     rate (the SAME per-worker/profession hourlyWage the calc already uses).
   *   - Contractor portion = max(0, totalHours − threshold) × a separate
   *     `contractorRate` supplied in the REQUEST (never persisted).
   * GROSS then equals personnelAmount + contractorAmount (the split total).
   *
   * Present ONLY when split was enabled for the calc; absent otherwise (default
   * OFF → the calc is byte-for-byte the existing flat/hourly behaviour). NET is
   * unchanged: net = gross (= combined personnel+contractor) − loans − advances.
   * The dashboard/batch (`calculateMany`) path never populates this.
   */
  split?: {
    enabled: boolean;
    threshold: number;
    personnelHours: number;
    personnelRate: number;
    personnelAmount: number;
    contractorHours: number;
    contractorRate: number;
    contractorAmount: number;
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * BATCH salary run (POST /salary/calculate-all) — manager table rows.
 *
 * A display-only per-worker roll-up for ALL active workers in the caller's
 * company. Uses the DEFAULT flat/hourly + fixed calc (NO hours-split — the batch
 * path never sets `split`). One row per active worker that HAS a configured wage;
 * workers with no wage are omitted and counted in `skippedCount`.
 * ──────────────────────────────────────────────────────────────────────── */

/** One worker's line in a batch salary run. */
export interface SalaryBatchRow {
  workerId: string;
  /**
   * Resolved rate the calc used. INFORMATIONAL for a fixed-MONTHLY row — there
   * `gross` is the fixed amount, NOT `hourlyWage × totalHours` (see `mode`).
   */
  hourlyWage: number;
  gross: number;
  currency: string;
  /** Resolved calc mode — lets the FE flag fixed-monthly rows (gross ≠ rate×hours). */
  mode: SalaryMode;
  /** Σ ATTENDANCE hours in the period (vacation/disease excluded). */
  totalHours: number;
  /** Σ approved LOAN amounts, period + company scoped (≥ 0). */
  loansTotal: number;
  /** Σ approved ADVANCE amounts, period + company scoped (≥ 0). */
  advancesTotal: number;
  /** = loansTotal + advancesTotal. */
  deductionsTotal: number;
  /** gross − deductionsTotal. NOT floored — CAN be negative (worker owes). */
  net: number;
}

/** Result of a batch salary run over one period. */
export interface SalaryBatchResult {
  periodStart: ISODate;
  periodEnd: ISODate;
  rows: SalaryBatchRow[];
  /** Active workers omitted because they have no configured wage. */
  skippedCount: number;
}

/**
 * The engine interface (FR-MGR-SRE-1). Callers depend only on this.
 * Concrete strategies (fixed / israeli-labor-law) implement it server-side and
 * are selected by config, never by the request (FR-MGR-SRE-2/3).
 */
export interface SalaryRuleEngine {
  compute(input: SalaryInput): SalaryResult;
}

/* ────────────────────────────────────────────────────────────────────────
 * Mapping between persisted SalaryCalcMode and wire SalaryMode
 * ──────────────────────────────────────────────────────────────────────── */

export function toSalaryMode(mode: SalaryCalcMode): SalaryMode {
  return mode === SalaryCalcMode.ISRAELI_LABOR_LAW ? 'israeli-labor-law' : 'fixed';
}

export function fromSalaryMode(mode: SalaryMode): SalaryCalcMode {
  return mode === 'israeli-labor-law'
    ? SalaryCalcMode.ISRAELI_LABOR_LAW
    : SalaryCalcMode.FIXED;
}
