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
