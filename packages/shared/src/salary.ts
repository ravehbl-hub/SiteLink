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
  /** Includes a 'stub' marker in v1 (FR-MGR-SRE-4). */
  engineVersion: string;
  computedAt: ISODate;
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
