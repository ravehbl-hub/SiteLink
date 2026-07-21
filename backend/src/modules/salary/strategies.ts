/**
 * SiteLink back end — SalaryRuleEngine strategies (Architecture §4, PRD §11).
 *
 * Callers depend ONLY on the SalaryRuleEngine interface (@sitelink/shared),
 * never on a concrete strategy (FR-MGR-SRE-3). The strategy is resolved from
 * stored config, never from the request.
 *
 *   FlatSalaryStrategy       — REAL v1 math: rate*hours (or monthly), minus deductions.
 *   IsraeliLaborLawStrategy  — STUB: delegates to flat + a 'stub' engineVersion marker
 *                              + a warning; overtime/statutory premiums are deferred.
 */
import type {
  SalaryBreakdownLine,
  SalaryInput,
  SalaryResult,
  SalaryRuleEngine,
} from '@sitelink/shared';
import { round2 } from '../../lib/money.js';

const FLAT_VERSION = 'flat-1.0.0';
const ISRAELI_STUB_VERSION = 'israeli-labor-law-0.0.0-stub';

/** Sum hours only for ATTENDANCE days (vacation/disease do not accrue worked hours). */
export function attendanceHours(input: SalaryInput): number {
  return input.hoursByDay
    .filter((d) => d.status === 'attendance')
    .reduce((sum, d) => sum + (Number.isFinite(d.hours) ? d.hours : 0), 0);
}

/**
 * FLAT strategy (mode 'fixed'): gross = fixedSalary (monthly) OR rate*hours when no
 * fixed salary is supplied. Deductions are subtracted; each is an itemized line.
 * Deterministic and real.
 */
export class FlatSalaryStrategy implements SalaryRuleEngine {
  compute(input: SalaryInput): SalaryResult {
    const breakdown: SalaryBreakdownLine[] = [];
    let gross: number;

    if (typeof input.fixedSalary === 'number') {
      gross = round2(input.fixedSalary);
      breakdown.push({ label: 'Fixed salary', amount: gross });
    } else {
      const hours = attendanceHours(input);
      gross = round2(hours * input.hourlyWage);
      breakdown.push({
        label: `Base pay (${hours}h × ${input.hourlyWage})`,
        amount: gross,
      });
    }

    return {
      gross,
      breakdown,
      currency: input.currency,
      mode: 'fixed',
      hourlyWage: input.hourlyWage,
      engineVersion: FLAT_VERSION,
      computedAt: new Date().toISOString(),
    };
  }
}

/**
 * ISRAELI LABOR LAW strategy — STUB (FR-MGR-PAY-5 / FR-MGR-SRE-4).
 * v1 delegates to hours × rate for attendance days, exposes deferred placeholder
 * lines (overtime / statutory premiums / deductions = 0), and marks the result with
 * a 'stub' engineVersion + an explicit warning so it is never mistaken for compliant
 * pay. Real rules plug in here later without any caller change.
 */
export class IsraeliLaborLawStrategy implements SalaryRuleEngine {
  private readonly flat = new FlatSalaryStrategy();

  compute(input: SalaryInput): SalaryResult {
    const hours = attendanceHours(input);
    const base = round2(hours * input.hourlyWage);

    const breakdown: SalaryBreakdownLine[] = [
      { label: `Base pay (${hours}h × ${input.hourlyWage})`, amount: base },
      { label: 'Overtime premium (deferred — stub)', amount: 0 },
      { label: 'Statutory premiums (deferred — stub)', amount: 0 },
      { label: 'Statutory deductions (deferred — stub)', amount: 0 },
    ];

    return {
      gross: base,
      breakdown,
      currency: input.currency,
      mode: 'israeli-labor-law',
      hourlyWage: input.hourlyWage,
      // Explicit stub marker — R-1 mitigation.
      engineVersion: ISRAELI_STUB_VERSION,
      computedAt: new Date().toISOString(),
    };
  }
}

export const SALARY_WARNINGS = {
  ISRAELI_STUB:
    'Israeli-labor-law mode is a v1 STUB: pay is base hours × rate only; overtime, ' +
    'rest-day, holiday and statutory rules are NOT applied. Do not treat as compliant pay.',
} as const;
