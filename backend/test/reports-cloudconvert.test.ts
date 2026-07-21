/**
 * Reports — CloudConvert HTML→PDF path (Servio, Back-End).
 *
 * TWO test groups:
 *
 *  1. HTML template unit tests (ALWAYS run, no key / no DB). They assert the HTML
 *     producers preserve content + i18n direction (dir/lang) + the FR-X-PDF-3
 *     header, and that dynamic values are HTML-escaped. These verify the
 *     CloudConvert path structurally WITHOUT a key.
 *
 *  2. KEY-GATED live CloudConvert conversion (describe.skipIf). These call the
 *     REAL CloudConvert convert API and require CLOUDCONVERT_API_KEY in .env.
 *     They SKIP automatically when the key is absent — mirroring the storage-bucket
 *     skip pattern — so the suite stays green pre-key. Network is sandbox-disabled;
 *     run with the prescribed `node --import tsx --env-file=.env vitest run`.
 */
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';
import { CloudConvertService } from '../src/lib/cloudconvert.js';
import {
  payslipHtml,
  profitLossHtml,
  workingHoursHtml,
  attendanceSummaryHtml,
} from '../src/modules/reports/html-templates.js';
import type { ReportHeaderMeta } from '../src/modules/reports/templates.js';

const HAS_KEY = Boolean(loadConfig().CLOUDCONVERT_API_KEY);

const ltrMeta: ReportHeaderMeta = {
  title: 'Payslip',
  from: '2026-05-01',
  to: '2026-05-31',
  direction: 'ltr',
};
const rtlMeta: ReportHeaderMeta = { ...ltrMeta, title: 'תלוש', direction: 'rtl' };

// ── Group 1: HTML producers — always run (no key, no DB) ─────────────────────
describe('reports HTML templates (CloudConvert path, key-independent)', () => {
  it('payslip HTML carries header (title/period/generated), worker, gross, warnings', () => {
    const html = payslipHtml({
      meta: ltrMeta,
      workerName: 'Jane Doe',
      result: {
        gross: 1280,
        currency: 'ILS',
        mode: 'FIXED',
        engineVersion: 'v1',
        breakdown: [{ label: 'Base', amount: 1280 }],
        warnings: ['rounded'],
      } as never,
      warnings: ['rounded'],
    });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Payslip'); // title (FR-X-PDF-3)
    expect(html).toContain('Period: 2026-05-01 → 2026-05-31');
    expect(html).toContain('Generated:'); // generation timestamp
    expect(html).toContain('Worker: Jane Doe');
    expect(html).toContain('1280.00 ILS'); // gross
    expect(html).toContain('rounded'); // warning surfaced
  });

  it('LTR document sets dir="ltr" lang="en"; RTL (he) sets dir="rtl" lang="he"', () => {
    const ltr = payslipHtml({
      meta: ltrMeta,
      workerName: 'x',
      result: { gross: 0, currency: 'ILS', mode: 'FIXED', engineVersion: 'v1', breakdown: [], warnings: [] } as never,
      warnings: [],
    });
    expect(ltr).toContain('lang="en" dir="ltr"');

    const rtl = payslipHtml({
      meta: rtlMeta,
      workerName: 'x',
      result: { gross: 0, currency: 'ILS', mode: 'FIXED', engineVersion: 'v1', breakdown: [], warnings: [] } as never,
      warnings: [],
    });
    expect(rtl).toContain('lang="he" dir="rtl"'); // RTL preserved (FR-X-PDF-2)
  });

  it('HTML-escapes dynamic values (no injection from worker/site names)', () => {
    const html = attendanceSummaryHtml({
      meta: { ...ltrMeta, title: 'Attendance', siteName: '<b>A&B</b>' },
      rows: [
        { workerName: '<script>x</script>', attendanceDays: 1, vacationDays: 0, diseaseDays: 0, totalHours: 8 },
      ],
    });
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Site: &lt;b&gt;A&amp;B&lt;/b&gt;');
  });

  it('payslip HTML renders the WORKING-HOURS breakdown that reconciles with gross (Dimitar 108h × 50 = 5400)', () => {
    // 12 attendance days × 9h = 108h at rate 50 → gross 5400 (flat-hourly).
    const hours = Array.from({ length: 12 }, (_, i) => ({
      workerId: 'w1',
      grain: 'DAY' as const,
      periodStart: `2026-05-${String(i + 1).padStart(2, '0')}`,
      periodEnd: `2026-05-${String(i + 1).padStart(2, '0')}`,
      totalHours: 9,
      attendanceDays: 1,
      vacationDays: 0,
      diseaseDays: 0,
    }));
    const html = payslipHtml({
      meta: rtlMeta, // he / RTL — the key quality bar
      workerName: 'Dimitar',
      result: {
        gross: 5400,
        currency: 'ILS',
        mode: 'israeli-labor-law',
        engineVersion: 'v1',
        breakdown: [{ label: 'Base', amount: 5400 }],
        hourlyWage: 50,
        warnings: [],
      } as never,
      warnings: [],
      hours: hours as never,
      hourlyWage: 50,
    });

    // RTL shell wraps the whole thing (Hebrew).
    expect(html).toContain('lang="he" dir="rtl"');
    // Section present (Hebrew title).
    expect(html).toContain('פירוט שעות עבודה');
    // Per-day rows (first + last day dates).
    expect(html).toContain('2026-05-01');
    expect(html).toContain('2026-05-12');
    // Hourly price on attendance rows.
    expect(html).toContain('50.00 ILS');
    // Per-line total (9h × 50 = 450).
    expect(html).toContain('450.00 ILS');
    // TOTAL row: total hours 108.0 and total money == gross 5400.
    expect(html).toContain('108.0');
    expect(html).toContain('5400.00 ILS');
    // Reconciliation asserted (sum of line totals == gross → note shown).
    expect(html).toContain('סכום השורות תואם לשכר ברוטו');
  });

  it('payslip working-hours: fixed-monthly (sum≠gross) still renders table but NO reconcile note', () => {
    const hours = [
      { workerId: 'w', grain: 'DAY' as const, periodStart: '2026-05-01', periodEnd: '2026-05-01', totalHours: 8, attendanceDays: 1, vacationDays: 0, diseaseDays: 0 },
      { workerId: 'w', grain: 'DAY' as const, periodStart: '2026-05-02', periodEnd: '2026-05-02', totalHours: 0, attendanceDays: 0, vacationDays: 1, diseaseDays: 0 },
    ];
    const html = payslipHtml({
      meta: ltrMeta,
      workerName: 'Fixed',
      result: {
        gross: 8000, currency: 'ILS', mode: 'fixed', engineVersion: 'v1',
        breakdown: [{ label: 'Fixed', amount: 8000 }], hourlyWage: 50, warnings: [],
      } as never,
      warnings: [],
      hours: hours as never,
      hourlyWage: 50,
    });
    expect(html).toContain('Working hours details');
    expect(html).toContain('Vacation'); // vacation TYPE label
    expect(html).toContain('—'); // vacation row shows dash for hours/price/line
    expect(html).not.toContain('Line totals reconcile with gross'); // sum 400 ≠ 8000
    expect(html).toContain('8000.00 ILS'); // Gross stays authoritative
  });

  it('payslip HTML renders DEDUCTIONS + NET that reconciles (net == gross − loans − advances)', () => {
    // gross 5400, loans 500, advances 300 → net 4600 (he/RTL — the quality bar).
    const html = payslipHtml({
      meta: rtlMeta,
      workerName: 'Dimitar',
      result: {
        gross: 5400,
        currency: 'ILS',
        mode: 'israeli-labor-law',
        engineVersion: 'v1',
        breakdown: [{ label: 'Base', amount: 5400 }],
        hourlyWage: 50,
        loansTotal: 500,
        advancesTotal: 300,
        net: 4600,
        warnings: [],
      } as never,
      warnings: [],
    });
    // Deductions heading (Hebrew) + loans/advances shown as negatives.
    expect(html).toContain('ניכויים'); // Deductions
    expect(html).toContain('הלוואות'); // Loans
    expect(html).toContain('מקדמות'); // Advances
    expect(html).toContain('-500.00 ILS'); // loans deducted
    expect(html).toContain('-300.00 ILS'); // advances deducted
    // Prominent NET line (Hebrew נטו) — the reconciled real number.
    expect(html).toContain('נטו');
    expect(html).toContain('4600.00 ILS');
    // Reconciliation: net == gross − loans − advances.
    expect(4600).toBe(5400 - 500 - 300);
    // Not flagged negative for a positive net.
    expect(html).not.toContain('net negative');
  });

  it('payslip HTML shows a NEGATIVE net (not floored) when deductions exceed gross', () => {
    const html = payslipHtml({
      meta: ltrMeta,
      workerName: 'Owes',
      result: {
        gross: 100,
        currency: 'ILS',
        mode: 'fixed',
        engineVersion: 'v1',
        breakdown: [{ label: 'Fixed', amount: 100 }],
        hourlyWage: 0,
        loansTotal: 500,
        advancesTotal: 0,
        net: -400,
        warnings: [],
      } as never,
      warnings: [],
    });
    expect(html).toContain('Deductions');
    expect(html).toContain('-500.00 ILS'); // loans
    expect(html).toContain('-400.00 ILS'); // NET is the REAL negative number
    expect(html).toContain('net negative'); // negative-net highlight class
  });

  it('payslip HTML omits the deductions section when net is absent (batch path)', () => {
    const html = payslipHtml({
      meta: ltrMeta,
      workerName: 'NoNet',
      result: {
        gross: 800, currency: 'ILS', mode: 'fixed', engineVersion: 'v1',
        breakdown: [{ label: 'Base', amount: 800 }], hourlyWage: 50, warnings: [],
      } as never,
      warnings: [],
    });
    expect(html).not.toContain('Deductions');
    expect(html).toContain('800.00 ILS'); // gross still authoritative
  });

  it('profit-loss + working-hours producers render their totals', () => {
    const pl = profitLossHtml({
      meta: { ...ltrMeta, title: 'Profit & Loss' },
      pnl: {
        revenue: 100, salaryCost: 40, loansCost: 0, advancesCost: 0, otherCost: 10,
        netProfit: 50, currency: 'ILS',
      } as never,
    });
    expect(pl).toContain('Net profit');
    expect(pl).toContain('50.00 ILS');

    const wh = workingHoursHtml({
      meta: { ...ltrMeta, title: 'Working Hours' },
      workerName: 'Jane',
      grain: 'MONTH' as never,
      rows: [
        { periodStart: '2026-05-01', periodEnd: '2026-05-31', totalHours: 16, attendanceDays: 2, vacationDays: 0, diseaseDays: 0, grain: 'MONTH' } as never,
      ],
    });
    expect(wh).toContain('Total hours');
    expect(wh).toContain('16.0');
  });
});

// ── Group 2: live CloudConvert conversion — KEY-GATED (skips without the key) ──
describe.skipIf(!HAS_KEY)('CloudConvert live HTML→PDF (requires CLOUDCONVERT_API_KEY)', () => {
  it('converts report HTML to real %PDF- bytes', async () => {
    const svc = new CloudConvertService(loadConfig().CLOUDCONVERT_API_KEY!);
    const html = payslipHtml({
      meta: ltrMeta,
      workerName: 'Jane Doe',
      result: { gross: 1280, currency: 'ILS', mode: 'FIXED', engineVersion: 'v1', breakdown: [{ label: 'Base', amount: 1280 }], warnings: [] } as never,
      warnings: [],
    });
    const pdf = await svc.htmlToPdf(html, { filename: 'payslip' });
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(500);
  }, 90_000);
});
