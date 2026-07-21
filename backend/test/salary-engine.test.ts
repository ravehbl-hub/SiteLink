/**
 * SM-3 — Salary computation for BOTH modes returns a result via the
 * SalaryRuleEngine with correct stub math (PRD §11.2, FR-MGR-SRE, FR-MGR-PAY-5).
 *
 * Pure logic — no DB. This is the highest-priority coverage for the Check gate.
 */
import { describe, it, expect } from 'vitest';
import type { SalaryInput } from '@sitelink/shared';
import {
  FlatSalaryStrategy,
  IsraeliLaborLawStrategy,
  SALARY_WARNINGS,
} from '../src/modules/salary/strategies.js';
import { SalaryEngineFactory } from '../src/modules/salary/factory.js';
import {
  calculateSalarySchema,
  DEFAULT_SPLIT_THRESHOLD,
} from '../src/modules/salary/schemas.js';

function baseInput(overrides: Partial<SalaryInput> = {}): SalaryInput {
  return {
    workerId: 'w1',
    periodStart: '2026-07-01T00:00:00.000Z',
    periodEnd: '2026-07-31T00:00:00.000Z',
    mode: 'fixed',
    hoursByDay: [
      { date: '2026-07-01', hours: 8, status: 'attendance' },
      { date: '2026-07-02', hours: 8, status: 'attendance' },
      { date: '2026-07-03', hours: 0, status: 'vacation' },
      { date: '2026-07-04', hours: 0, status: 'disease' },
    ],
    hourlyWage: 50,
    currency: 'ILS',
    ...overrides,
  };
}

describe('FlatSalaryStrategy (mode: fixed) — real v1 math', () => {
  const engine = new FlatSalaryStrategy();

  it('fixedSalary path: gross = fixedSalary, single breakdown line (PRD §11.2)', () => {
    const r = engine.compute(baseInput({ fixedSalary: 12000 }));
    expect(r.gross).toBe(12000);
    expect(r.breakdown).toHaveLength(1);
    expect(r.breakdown[0]).toMatchObject({ label: 'Fixed salary', amount: 12000 });
    expect(r.mode).toBe('fixed');
    expect(r.currency).toBe('ILS');
  });

  it('hourly path: gross = attendance hours × rate (vacation/disease excluded)', () => {
    // 8h + 8h attendance × 50 = 800; vacation/disease days contribute 0.
    const r = engine.compute(baseInput());
    expect(r.gross).toBe(800);
    expect(r.breakdown[0].amount).toBe(800);
    expect(r.breakdown[0].label).toContain('16h');
    // hourlyWage exposed on the result reconciles: gross === hours × hourlyWage.
    expect(r.hourlyWage).toBe(50);
    expect(r.gross).toBe(16 * r.hourlyWage);
  });

  it('exposes the resolved hourlyWage even for a fixed MONTHLY salary (informational)', () => {
    // gross is the fixed amount, NOT hourlyWage × hours — but the rate is still carried.
    const r = engine.compute(baseInput({ fixedSalary: 12000, hourlyWage: 50 }));
    expect(r.gross).toBe(12000);
    expect(r.hourlyWage).toBe(50);
  });

  it('rounds money to 2 decimals', () => {
    const r = engine.compute(
      baseInput({
        hoursByDay: [{ date: '2026-07-01', hours: 3.333, status: 'attendance' }],
        hourlyWage: 33.33,
      }),
    );
    // 3.333 * 33.33 = 111.09... → round2
    expect(r.gross).toBe(111.09);
  });

  it('engineVersion is a stable flat marker (not a stub)', () => {
    const r = engine.compute(baseInput({ fixedSalary: 100 }));
    expect(r.engineVersion).toBe('flat-1.0.0');
    expect(r.engineVersion).not.toContain('stub');
  });
});

describe('IsraeliLaborLawStrategy — STUB (FR-MGR-SRE-4, R-1 mitigation)', () => {
  const engine = new IsraeliLaborLawStrategy();

  it('gross = attendance hours × rate (base only; premiums deferred)', () => {
    const r = engine.compute(baseInput({ mode: 'israeli-labor-law' }));
    expect(r.gross).toBe(800); // 16h × 50
    expect(r.mode).toBe('israeli-labor-law');
    expect(r.hourlyWage).toBe(50);
  });

  it('exposes deferred placeholder lines set to 0 (overtime/statutory/deductions)', () => {
    const r = engine.compute(baseInput({ mode: 'israeli-labor-law' }));
    const deferred = r.breakdown.filter((l) => /deferred/i.test(l.label));
    expect(deferred.length).toBe(3);
    for (const line of deferred) expect(line.amount).toBe(0);
  });

  it('engineVersion carries an explicit stub marker (never mistaken for compliant pay)', () => {
    const r = engine.compute(baseInput({ mode: 'israeli-labor-law' }));
    expect(r.engineVersion).toBe('israeli-labor-law-0.0.0-stub');
    expect(r.engineVersion).toContain('stub');
  });

  it('SALARY_WARNINGS.ISRAELI_STUB clearly warns it is not compliant pay', () => {
    expect(SALARY_WARNINGS.ISRAELI_STUB).toMatch(/STUB/);
    expect(SALARY_WARNINGS.ISRAELI_STUB).toMatch(/not.*compliant|Do not treat as compliant/i);
  });
});

describe('calculateSalarySchema — HOURS-SPLIT PAYMENT validation (request-time, default OFF)', () => {
  const base = {
    workerId: 'w1',
    periodStart: '2026-07-01T00:00:00.000Z',
    periodEnd: '2026-07-31T00:00:00.000Z',
  };

  it('DEFAULT: splitEnabled=false, threshold defaults to 236, contractorRate optional', () => {
    const parsed = calculateSalarySchema.parse(base);
    expect(parsed.splitEnabled).toBe(false);
    expect(parsed.splitThreshold).toBe(DEFAULT_SPLIT_THRESHOLD);
    expect(parsed.splitThreshold).toBe(236);
    expect(parsed.contractorRate).toBeUndefined();
  });

  it('splitEnabled WITHOUT contractorRate → validation error (→ 400)', () => {
    const res = calculateSalarySchema.safeParse({ ...base, splitEnabled: true });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0].path).toContain('contractorRate');
    }
  });

  it('splitEnabled WITH contractorRate (>=0) → valid; threshold editable', () => {
    const parsed = calculateSalarySchema.parse({
      ...base,
      splitEnabled: true,
      splitThreshold: 200,
      contractorRate: 80,
    });
    expect(parsed.splitEnabled).toBe(true);
    expect(parsed.splitThreshold).toBe(200);
    expect(parsed.contractorRate).toBe(80);
  });

  it('rejects a negative contractorRate', () => {
    const res = calculateSalarySchema.safeParse({
      ...base,
      splitEnabled: true,
      contractorRate: -5,
    });
    expect(res.success).toBe(false);
  });
});

describe('SalaryEngineFactory — strategy resolved by mode, not by caller (FR-MGR-SRE-2/3)', () => {
  const factory = new SalaryEngineFactory();

  it('resolves fixed → FlatSalaryStrategy', () => {
    expect(factory.resolve('fixed')).toBeInstanceOf(FlatSalaryStrategy);
  });

  it('resolves israeli-labor-law → IsraeliLaborLawStrategy', () => {
    expect(factory.resolve('israeli-labor-law')).toBeInstanceOf(IsraeliLaborLawStrategy);
  });

  it('both modes produce a result honoring the SalaryResult contract shape (SM-3)', () => {
    for (const mode of ['fixed', 'israeli-labor-law'] as const) {
      const r = factory.resolve(mode).compute(baseInput({ mode }));
      expect(r).toHaveProperty('gross');
      expect(Array.isArray(r.breakdown)).toBe(true);
      expect(r).toHaveProperty('currency');
      expect(r).toHaveProperty('hourlyWage');
      expect(r.hourlyWage).toBe(50);
      expect(r.mode).toBe(mode);
      expect(typeof r.engineVersion).toBe('string');
      expect(() => new Date(r.computedAt).toISOString()).not.toThrow();
    }
  });
});
