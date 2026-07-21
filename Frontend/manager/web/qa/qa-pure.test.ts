/**
 * Bugo (Web QA) — regression guards for load-bearing pure logic.
 * Runs with the workspace-resident vitest (no new deps). These mirror the exact
 * branch logic in lib/api/client.ts (envelope unwrap) and lib/format.ts helpers,
 * which are otherwise coupled to import.meta.env / i18next and hard to import in
 * isolation. If the source logic changes, update these in lockstep.
 */
import { describe, it, expect } from 'vitest';

/* ── API error-envelope unwrap (client.ts lines 95-101) ─────────────────── */
interface Env { code: string; message: string; details?: unknown }
function unwrapEnvelope(status: number, parsed: unknown): Env {
  return parsed && typeof parsed === 'object' && 'error' in parsed
    ? (parsed as { error: Env }).error
    : { code: 'UNKNOWN', message: `Request failed (${status})` };
}

describe('API envelope unwrap', () => {
  it('extracts the { error } envelope from the back end', () => {
    const e = unwrapEnvelope(403, { error: { code: 'FORBIDDEN', message: 'no' } });
    expect(e.code).toBe('FORBIDDEN');
    expect(e.message).toBe('no');
  });
  it('falls back to UNKNOWN when body has no error field', () => {
    const e = unwrapEnvelope(500, { something: true });
    expect(e.code).toBe('UNKNOWN');
    expect(e.message).toBe('Request failed (500)');
  });
  it('falls back to UNKNOWN for empty/undefined body', () => {
    const e = unwrapEnvelope(502, undefined);
    expect(e.code).toBe('UNKNOWN');
  });
});

/* ── Date helpers (format.ts) ───────────────────────────────────────────── */
function toDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}
function dateInputToISO(value: string): string {
  if (!value) return '';
  return new Date(`${value}T00:00:00.000Z`).toISOString();
}
function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { from: from.toISOString(), to: to.toISOString() };
}

describe('date helpers', () => {
  it('toDateInput slices ISO to YYYY-MM-DD and guards null', () => {
    expect(toDateInput('2026-07-12T00:00:00.000Z')).toBe('2026-07-12');
    expect(toDateInput(null)).toBe('');
    expect(toDateInput(undefined)).toBe('');
  });
  it('dateInputToISO round-trips a date-only value to midnight UTC', () => {
    expect(dateInputToISO('2026-07-12')).toBe('2026-07-12T00:00:00.000Z');
    expect(dateInputToISO('')).toBe('');
  });
  it('currentMonthRange spans first→last day of the current month', () => {
    const { from, to } = currentMonthRange();
    expect(from.slice(8, 10)).toBe('01');
    expect(new Date(from).getUTCDate()).toBe(1);
    // last day: adding one day rolls into next month
    const next = new Date(to); next.setUTCDate(next.getUTCDate() + 1);
    expect(next.getUTCDate()).toBe(1);
  });
});

/* ── Salary hours-split auto-open (features/salary/SalaryScreen.tsx) ───────────
 * Replicated here (not imported) because SalaryScreen.tsx pulls react / i18next /
 * react-query at module scope. These MUST stay in lockstep with the real exported
 * helpers `attendanceHours` and `shouldAutoOpenSplit` (and `SPLIT_THRESHOLD_DEFAULT`).
 * whType mirrors the exclusive DAY-bucket classification in the screen. */
const SPLIT_THRESHOLD_DEFAULT = 236;
interface WHRow { totalHours: number; vacationDays: number; diseaseDays: number }
function whType(wh: WHRow): 'ATTENDANCE' | 'VACATION' | 'DISEASE' {
  if (wh.vacationDays >= 1) return 'VACATION';
  if (wh.diseaseDays >= 1) return 'DISEASE';
  return 'ATTENDANCE';
}
function attendanceHours(rows: WHRow[]): number {
  return rows.reduce(
    (sum, row) => sum + (whType(row) === 'ATTENDANCE' ? row.totalHours : 0),
    0,
  );
}
function shouldAutoOpenSplit(
  attendanceHoursTotal: number,
  threshold: number,
  splitAlreadyEnabled: boolean,
): boolean {
  return attendanceHoursTotal > threshold && !splitAlreadyEnabled;
}
const att = (h: number): WHRow => ({ totalHours: h, vacationDays: 0, diseaseDays: 0 });
const vac = (h: number): WHRow => ({ totalHours: h, vacationDays: 1, diseaseDays: 0 });
const sick = (h: number): WHRow => ({ totalHours: h, vacationDays: 0, diseaseDays: 1 });

describe('salary split auto-open logic', () => {
  it('250h ATTENDANCE > 236 with split off → auto-opens', () => {
    const hrs = attendanceHours([att(250)]);
    expect(hrs).toBe(250);
    expect(shouldAutoOpenSplit(hrs, SPLIT_THRESHOLD_DEFAULT, false)).toBe(true);
  });
  it('exactly 236h → does NOT auto-open (strictly greater)', () => {
    expect(shouldAutoOpenSplit(236, SPLIT_THRESHOLD_DEFAULT, false)).toBe(false);
  });
  it('236h + already-enabled → does NOT auto-open', () => {
    expect(shouldAutoOpenSplit(236, SPLIT_THRESHOLD_DEFAULT, true)).toBe(false);
    // even 250 with split already on stays false (never fights the manager)
    expect(shouldAutoOpenSplit(250, SPLIT_THRESHOLD_DEFAULT, true)).toBe(false);
  });
  it('excludes vacation/disease from the attendance sum', () => {
    // 200 attendance + 100 vacation → 200 (not 300) → no auto-open
    const hrs = attendanceHours([att(200), vac(100)]);
    expect(hrs).toBe(200);
    expect(shouldAutoOpenSplit(hrs, SPLIT_THRESHOLD_DEFAULT, false)).toBe(false);
    // disease also excluded
    expect(attendanceHours([att(100), sick(150)])).toBe(100);
  });
});

/* ── Batch salary row math (features/salary/SalaryScreen.tsx batchRowNet) ──────
 * Replicated here (not imported) for the same module-scope reasons as above.
 * MUST stay in lockstep with the exported `batchRowNet` helper AND the backend
 * SalaryBatchRow contract: deductionsTotal = loansTotal + advancesTotal, and
 * net = gross − deductionsTotal (NOT floored — can go negative). */
function batchRowNet(
  gross: number,
  loansTotal: number,
  advancesTotal: number,
): { deductionsTotal: number; net: number } {
  const deductionsTotal = loansTotal + advancesTotal;
  return { deductionsTotal, net: gross - deductionsTotal };
}
// PURE — sum the batch rows' totalHours (mirrors the table's per-row Work hours).
function batchHoursTotal(rows: { totalHours: number }[]): number {
  return rows.reduce((sum, r) => sum + r.totalHours, 0);
}

describe('batch salary row math', () => {
  it('deductionsTotal = loans + advances; net = gross − deductions', () => {
    const { deductionsTotal, net } = batchRowNet(5000, 800, 200);
    expect(deductionsTotal).toBe(1000);
    expect(net).toBe(4000);
  });
  it('flags a NEGATIVE net when loans+advances exceed gross', () => {
    // gross 1000, loans 800, advances 400 → deductions 1200, net −200
    const { deductionsTotal, net } = batchRowNet(1000, 800, 400);
    expect(deductionsTotal).toBe(1200);
    expect(net).toBe(-200);
    expect(net < 0).toBe(true); // FE renders this row's net in the danger color
  });
  it('zero deductions leaves net === gross', () => {
    const { deductionsTotal, net } = batchRowNet(3200, 0, 0);
    expect(deductionsTotal).toBe(0);
    expect(net).toBe(3200);
  });
  it('sums per-row work hours across the batch', () => {
    expect(batchHoursTotal([{ totalHours: 160 }, { totalHours: 236 }, { totalHours: 0 }])).toBe(396);
  });
});

/* ── Payroll batch export filename (SalaryScreen.payrollExportFilename) ──────
 * Mirrors the backend attachment name `payroll-<YYYYMMDD>-<YYYYMMDD>.<ext>`
 * (reports/routes.ts periodTag). from/to are ISO datetimes; the tag is the date
 * part with dashes stripped. Kept in lockstep with the source builder. */
function payrollExportFilename(from: string, to: string, ext: 'pdf' | 'xlsx'): string {
  const tag = (s: string): string => s.slice(0, 10).replace(/-/g, '');
  return `payroll-${tag(from)}-${tag(to)}.${ext}`;
}

describe('payroll batch export filename', () => {
  it('builds a compact YYYYMMDD-YYYYMMDD name for the PDF', () => {
    expect(
      payrollExportFilename('2026-06-01T00:00:00.000Z', '2026-06-30T23:59:59.000Z', 'pdf'),
    ).toBe('payroll-20260601-20260630.pdf');
  });
  it('uses the .xlsx extension for the Excel export', () => {
    expect(
      payrollExportFilename('2026-06-01T00:00:00.000Z', '2026-06-30T23:59:59.000Z', 'xlsx'),
    ).toBe('payroll-20260601-20260630.xlsx');
  });
  it('tolerates a bare date (no time component)', () => {
    expect(payrollExportFilename('2026-01-05', '2026-01-31', 'pdf')).toBe(
      'payroll-20260105-20260131.pdf',
    );
  });
});
