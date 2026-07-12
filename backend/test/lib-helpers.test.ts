/**
 * Pure lib helpers — money / dates / pagination. No DB. These feed salary math,
 * Working-Hours bucketing (FR-MGR-ATT-2) and list payload bounding (NFR-PERF-2).
 */
import { describe, it, expect } from 'vitest';
import { toNumber, toNumberOrNull, round2 } from '../src/lib/money.js';
import { isoWeekKey, monthKey, toDateOnly } from '../src/lib/dates.js';
import { paginate, PaginationQuery } from '../src/lib/pagination.js';

describe('money.toNumber — Prisma Decimal / string / number coercion', () => {
  it('handles number, string, and null/undefined', () => {
    expect(toNumber(42)).toBe(42);
    expect(toNumber('42.5')).toBe(42.5);
    expect(toNumber(null)).toBe(0);
    expect(toNumber(undefined)).toBe(0);
  });
  it('handles Decimal-like objects (toNumber / toString)', () => {
    expect(toNumber({ toNumber: () => 7.25, toString: () => '7.25' })).toBe(7.25);
    expect(toNumber({ toString: () => '9.99' })).toBe(9.99);
  });
  it('toNumberOrNull preserves null', () => {
    expect(toNumberOrNull(null)).toBeNull();
    expect(toNumberOrNull('3')).toBe(3);
  });
});

describe('money.round2 — 2-decimal currency rounding', () => {
  it('rounds to 2 decimals', () => {
    expect(round2(111.094)).toBe(111.09);
    expect(round2(111.095)).toBe(111.1);
    expect(round2(800)).toBe(800);
  });
});

describe('dates — bucketing keys (FR-MGR-ATT-2)', () => {
  it('toDateOnly → YYYY-MM-DD', () => {
    expect(toDateOnly(new Date('2026-07-12T13:45:00Z'))).toBe('2026-07-12');
  });
  it('monthKey → YYYY-MM', () => {
    expect(monthKey(new Date('2026-07-12T00:00:00Z'))).toBe('2026-07');
    expect(monthKey(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01');
  });
  it('isoWeekKey → YYYY-Www, stable across a Mon-start week', () => {
    // 2026-07-06 is a Monday; 2026-07-12 is the Sunday of the same ISO week.
    const mon = isoWeekKey(new Date('2026-07-06T00:00:00Z'));
    const sun = isoWeekKey(new Date('2026-07-12T00:00:00Z'));
    expect(mon).toMatch(/^2026-W\d{2}$/);
    expect(sun).toBe(mon);
  });
});

describe('pagination — bounded payloads (NFR-PERF-2)', () => {
  it('paginate wraps items with total/page/pageSize', () => {
    const p = paginate([1, 2, 3], 12, { page: 2, pageSize: 3 });
    expect(p).toEqual({ items: [1, 2, 3], total: 12, page: 2, pageSize: 3 });
  });
  it('PaginationQuery applies defaults and caps pageSize at 200', () => {
    expect(PaginationQuery.parse({})).toEqual({ page: 1, pageSize: 50 });
    expect(() => PaginationQuery.parse({ pageSize: 201 })).toThrow();
    expect(() => PaginationQuery.parse({ page: 0 })).toThrow();
  });
});
