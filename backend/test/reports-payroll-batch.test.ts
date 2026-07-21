/**
 * Reports — Payroll batch ("All workers") export (Servio, Back-End).
 *
 * Pure unit tests (no key / no DB): the payrollBatchHtml producer and the xlsx
 * cell sanitizer. They assert the batch report escapes dynamic values, preserves
 * i18n direction, marks fixed-monthly rows, and that the CSV/formula-injection
 * guard neutralizes attacker-influenceable worker names.
 */
import { describe, it, expect } from 'vitest';
import { payrollBatchHtml } from '../src/modules/reports/html-templates.js';
import { sanitizeCell } from '../src/modules/reports/service.js';
import type { ReportHeaderMeta } from '../src/modules/reports/templates.js';
import type { PayrollBatchRowView } from '../src/modules/reports/templates.js';

const metaEn: ReportHeaderMeta = {
  title: 'Payroll',
  from: '2026-06-01',
  to: '2026-06-30',
  direction: 'ltr',
  lang: 'en',
};

const metaHe: ReportHeaderMeta = { ...metaEn, direction: 'rtl', lang: 'he' };

function row(over: Partial<PayrollBatchRowView> = {}): PayrollBatchRowView {
  return {
    workerName: 'Dana Levi',
    totalHours: 160,
    hourlyWage: 50,
    gross: 8000,
    deductionsTotal: 500,
    net: 7500,
    currency: 'ILS',
    isMonthly: false,
    ...over,
  };
}

describe('payrollBatchHtml', () => {
  it('renders the 7 columns + a row with the worker name and money cells', () => {
    const html = payrollBatchHtml({ meta: metaEn, rows: [row()] });
    expect(html).toContain('Dana Levi');
    expect(html).toContain('8000.00 ILS'); // gross
    expect(html).toContain('7500.00 ILS'); // net
    expect(html).toContain('Work hours');
  });

  it('escapes HTML-significant characters in a worker name (no injection)', () => {
    const html = payrollBatchHtml({
      meta: metaEn,
      rows: [row({ workerName: '<script>alert(1)</script>' })],
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('marks a fixed-monthly row with a * and shows the legend', () => {
    const html = payrollBatchHtml({ meta: metaEn, rows: [row({ isMonthly: true })] });
    expect(html).toContain('<sup>*</sup>');
    expect(html).toContain('informational');
  });

  it('flags a negative net with the deduction (danger) class', () => {
    const html = payrollBatchHtml({ meta: metaEn, rows: [row({ net: -200 })] });
    // the net cell carries the deduction class only when net < 0
    expect(html).toMatch(/class="num" class="deduction"|class="num"[^>]*deduction/);
    expect(html).toContain('-200.00 ILS');
  });

  it('renders RTL (dir="rtl", lang he) for Hebrew', () => {
    const html = payrollBatchHtml({ meta: metaHe, rows: [row()] });
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('עובד'); // he "Worker"
  });

  it('shows an empty-state message when there are no rows', () => {
    const html = payrollBatchHtml({ meta: metaEn, rows: [] });
    expect(html).toContain('No salary data for this period');
  });

  it('foots a single-currency total but omits it for mixed currencies', () => {
    const single = payrollBatchHtml({
      meta: metaEn,
      rows: [row({ gross: 100, net: 100, deductionsTotal: 0 }), row({ gross: 200, net: 200, deductionsTotal: 0 })],
    });
    expect(single).toContain('<tfoot>');
    const mixed = payrollBatchHtml({
      meta: metaEn,
      rows: [row({ currency: 'ILS' }), row({ currency: 'USD' })],
    });
    expect(mixed).not.toContain('<tfoot>');
  });
});

describe('sanitizeCell — spreadsheet formula-injection guard', () => {
  it('prefixes a leading formula trigger with an apostrophe', () => {
    expect(sanitizeCell('=1+1')).toBe("'=1+1");
    expect(sanitizeCell('+cmd')).toBe("'+cmd");
    expect(sanitizeCell('-2')).toBe("'-2");
    expect(sanitizeCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });
  it('leaves a normal worker name untouched', () => {
    expect(sanitizeCell('Dana Levi')).toBe('Dana Levi');
    expect(sanitizeCell('John O=Brien')).toBe('John O=Brien'); // trigger not leading
    expect(sanitizeCell('')).toBe('');
  });
});
