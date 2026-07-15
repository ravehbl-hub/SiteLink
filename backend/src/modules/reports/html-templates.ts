/**
 * SiteLink back end — HTML report templates (CloudConvert HTML→PDF path).
 *
 * These are the print-oriented HTML equivalents of the @react-pdf templates in
 * templates.ts. They exist ALONGSIDE the react-pdf documents (minimal-risk
 * migration): when CLOUDCONVERT_API_KEY is present the reports service renders
 * these to a string and sends them to CloudConvert; when absent it uses the
 * react-pdf renderer as before. Content, header (title / site / period /
 * generation timestamp per FR-X-PDF-3) and i18n direction (RTL for he, LTR
 * otherwise) are preserved 1:1 with the react-pdf output.
 *
 * No react-dom dependency: these are plain string builders (all dynamic values
 * HTML-escaped) so no new heavy dep is pulled in for the HTML path.
 */
import type { ProfitLoss, SalaryResult, WorkingHours } from '@sitelink/shared';
import type { ReportHeaderMeta, AttendanceSummaryRow } from './templates.js';

/** Escape the five HTML-significant characters. All dynamic text passes through. */
function esc(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Shared print CSS — mirrors the react-pdf StyleSheet (fonts, rows, totals). */
const STYLES = `
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Helvetica, Arial, sans-serif; font-size: 11px; color: #000; }
  .page { padding: 32px; }
  .header { margin-bottom: 16px; border-bottom: 1px solid #000; padding-bottom: 8px; }
  .title { font-size: 18px; margin: 0 0 4px 0; }
  .meta { font-size: 9px; color: #555; margin: 0; }
  .bold { font-weight: bold; }
  .row { display: flex; flex-direction: row; justify-content: space-between;
         padding: 3px 0; border-bottom: 0.5px solid #ddd; }
  .total { display: flex; flex-direction: row; justify-content: space-between; margin-top: 10px; }
  .warn { margin-top: 12px; font-size: 9px; color: #a00; }
  [dir="rtl"] .row, [dir="rtl"] .total { flex-direction: row-reverse; }
`;

/**
 * Wrap body markup in a full HTML document carrying lang + dir so CloudConvert's
 * html→pdf engine lays out RTL (he) vs LTR (en/tr) correctly — the HTML analogue
 * of the react-pdf `direction` on the page.
 */
function documentShell(meta: ReportHeaderMeta, bodyHtml: string): string {
  const dir = meta.direction; // 'ltr' | 'rtl'
  const lang = dir === 'rtl' ? 'he' : 'en';
  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(meta.title)}</title>
<style>${STYLES}</style>
</head>
<body>
<div class="page" dir="${dir}">
${headerHtml(meta)}
${bodyHtml}
</div>
</body>
</html>`;
}

/** Report header: title + (site) period + generation timestamp (FR-X-PDF-3). */
function headerHtml(meta: ReportHeaderMeta): string {
  const site = meta.siteName ? `Site: ${esc(meta.siteName)}  ·  ` : '';
  return `<div class="header">
  <h1 class="title">${esc(meta.title)}</h1>
  <p class="meta">${site}Period: ${esc(meta.from)} → ${esc(meta.to)}  ·  Generated: ${esc(new Date().toISOString())}</p>
</div>`;
}

function rowHtml(left: string, right: string): string {
  return `<div class="row"><span>${left}</span><span>${right}</span></div>`;
}

/** Payslip HTML (mirror of PayslipDocument). */
export function payslipHtml(props: {
  meta: ReportHeaderMeta;
  workerName: string;
  result: SalaryResult;
  warnings: string[];
}): string {
  const { meta, workerName, result, warnings } = props;
  const lines = result.breakdown
    .map((l) => rowHtml(esc(l.label), `${esc(l.amount.toFixed(2))} ${esc(result.currency)}`))
    .join('\n');
  const warns = warnings
    .map((w) => `<p class="warn">⚠ ${esc(w)}</p>`)
    .join('\n');
  const body = `
<p class="bold">Worker: ${esc(workerName)}</p>
<p class="meta">Mode: ${esc(result.mode)}  ·  Engine: ${esc(result.engineVersion)}</p>
<div>${lines}</div>
<div class="total"><span class="bold">Gross</span><span class="bold">${esc(result.gross.toFixed(2))} ${esc(result.currency)}</span></div>
${warns}`;
  return documentShell(meta, body);
}

/** Profit & Loss HTML (mirror of ProfitLossDocument). */
export function profitLossHtml(props: { meta: ReportHeaderMeta; pnl: ProfitLoss }): string {
  const { meta, pnl } = props;
  const money = (v: number): string => `${esc(v.toFixed(2))} ${esc(pnl.currency)}`;
  const lines: Array<[string, number]> = [
    ['Revenue', pnl.revenue],
    ['Salary cost', pnl.salaryCost],
    ['Loans cost', pnl.loansCost],
    ['Advances cost', pnl.advancesCost],
    ['Other cost', pnl.otherCost],
  ];
  const rows = lines.map(([label, amount]) => rowHtml(esc(label), money(amount))).join('\n');
  const body = `
<div>${rows}</div>
<div class="total"><span class="bold">Net profit</span><span class="bold">${money(pnl.netProfit)}</span></div>`;
  return documentShell(meta, body);
}

/** Working Hours HTML (mirror of WorkingHoursDocument). */
export function workingHoursHtml(props: {
  meta: ReportHeaderMeta;
  workerName: string;
  grain: WorkingHours['grain'];
  rows: WorkingHours[];
}): string {
  const { meta, workerName, grain, rows } = props;
  const sorted = [...rows].sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  const totalHours = sorted.reduce((sum, r) => sum + r.totalHours, 0);
  const body = `
<p class="bold">Worker: ${esc(workerName)}</p>
<p class="meta">Grain: ${esc(grain)}</p>
<div>${sorted
    .map((r) =>
      rowHtml(
        r.periodStart === r.periodEnd
          ? esc(r.periodStart)
          : `${esc(r.periodStart)} → ${esc(r.periodEnd)}`,
        `H:${esc(r.totalHours.toFixed(1))}  A:${esc(r.attendanceDays)}  V:${esc(r.vacationDays)}  D:${esc(r.diseaseDays)}`,
      ),
    )
    .join('\n')}</div>
<div class="total"><span class="bold">Total hours</span><span class="bold">${esc(totalHours.toFixed(1))}</span></div>`;
  return documentShell(meta, body);
}

/** Attendance summary HTML (mirror of AttendanceSummaryDocument). */
export function attendanceSummaryHtml(props: {
  meta: ReportHeaderMeta;
  rows: AttendanceSummaryRow[];
}): string {
  const { meta, rows } = props;
  const body = `<div>${rows
    .map((r) =>
      rowHtml(
        esc(r.workerName),
        `A:${esc(r.attendanceDays)}  V:${esc(r.vacationDays)}  D:${esc(r.diseaseDays)}  H:${esc(r.totalHours.toFixed(1))}`,
      ),
    )
    .join('\n')}</div>`;
  return documentShell(meta, body);
}
