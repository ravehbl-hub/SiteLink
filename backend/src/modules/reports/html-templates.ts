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

/**
 * i18n labels for the working-hours breakdown section on the payslip. The
 * payslip already renders per `meta.direction`; we derive the language the same
 * way the shell does (rtl → he, otherwise en) plus a lightweight `tr` opt-in via
 * meta.lang when present. Kept local & minimal — no dependency on the FE catalog.
 */
type HoursLang = 'he' | 'en' | 'tr';

interface HoursLabels {
  section: string;
  date: string;
  hours: string;
  type: string;
  hourlyPrice: string;
  lineTotal: string;
  total: string;
  attendance: string;
  vacation: string;
  disease: string;
  reconcileNote: string;
  /** NET WAGE (נטו) deductions section labels. */
  gross: string;
  deductions: string;
  loans: string;
  advances: string;
  net: string;
}

const HOURS_LABELS: Record<HoursLang, HoursLabels> = {
  he: {
    section: 'פירוט שעות עבודה',
    date: 'תאריך',
    hours: 'שעות',
    type: 'סוג',
    hourlyPrice: 'מחיר לשעה',
    lineTotal: 'סה"כ שורה',
    total: 'סה"כ',
    attendance: 'נוכחות',
    vacation: 'חופשה',
    disease: 'מחלה',
    reconcileNote: 'סכום השורות תואם לשכר ברוטו',
    gross: 'ברוטו',
    deductions: 'ניכויים',
    loans: 'הלוואות',
    advances: 'מקדמות',
    net: 'נטו',
  },
  en: {
    section: 'Working hours details',
    date: 'Date',
    hours: 'Hours',
    type: 'Type',
    hourlyPrice: 'Hourly price',
    lineTotal: 'Line total',
    total: 'Total',
    attendance: 'Attendance',
    vacation: 'Vacation',
    disease: 'Disease',
    reconcileNote: 'Line totals reconcile with gross',
    gross: 'Gross',
    deductions: 'Deductions',
    loans: 'Loans',
    advances: 'Advances',
    net: 'Net',
  },
  tr: {
    section: 'Çalışma saatleri ayrıntıları',
    date: 'Tarih',
    hours: 'Saat',
    type: 'Tür',
    hourlyPrice: 'Saatlik ücret',
    lineTotal: 'Satır toplamı',
    total: 'Toplam',
    attendance: 'Devam',
    vacation: 'İzin',
    disease: 'Hastalık',
    reconcileNote: 'Satır toplamları brüt ile uyumlu',
    gross: 'Brüt',
    deductions: 'Kesintiler',
    loans: 'Krediler',
    advances: 'Avanslar',
    net: 'Net',
  },
};

function hoursLangFor(meta: ReportHeaderMeta): HoursLang {
  const lang = (meta as { lang?: string }).lang;
  if (lang === 'tr') return 'tr';
  return meta.direction === 'rtl' ? 'he' : 'en';
}

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
  .section-title { font-size: 13px; font-weight: bold; margin: 16px 0 6px 0; }
  table.hours { width: 100%; border-collapse: collapse; font-size: 10px; }
  table.hours th, table.hours td { border-bottom: 0.5px solid #ddd; padding: 4px 6px; text-align: left; }
  table.hours thead th { border-bottom: 1px solid #000; font-weight: bold; }
  table.hours tfoot td { border-top: 1px solid #000; font-weight: bold; }
  table.hours td.num, table.hours th.num { text-align: right; }
  [dir="rtl"] table.hours th, [dir="rtl"] table.hours td { text-align: right; }
  [dir="rtl"] table.hours td.num, [dir="rtl"] table.hours th.num { text-align: left; }
  .reconcile { margin-top: 6px; font-size: 9px; color: #060; }
  .deduction { color: #a00; }
  .net { display: flex; flex-direction: row; justify-content: space-between;
         margin-top: 10px; border-top: 1px solid #000; padding-top: 6px; font-size: 14px; }
  .net.negative span { color: #a00; }
  [dir="rtl"] .net { flex-direction: row-reverse; }
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

/**
 * Working-hours breakdown table (per-DAY) for the payslip. Mirrors the on-screen
 * "Working hours details" section. Columns: DATE | HOURS | TYPE | HOURLY PRICE |
 * LINE TOTAL. TYPE is derived from the day flags (vacation/disease/attendance).
 * LINE TOTAL = totalHours × hourlyWage for ATTENDANCE rows; '—' for non-work.
 * A TOTAL row sums hours + money. Reconciliation: for a flat-hourly calc the sum
 * of line totals equals `result.gross` (same rate & data the calc used); for a
 * fixed-monthly calc it may not, so the reconcile note only shows when they match.
 */
function workingHoursSectionHtml(
  meta: ReportHeaderMeta,
  hours: WorkingHours[],
  hourlyWage: number,
  currency: string,
  gross: number,
): string {
  if (!hours.length) return '';
  const L = HOURS_LABELS[hoursLangFor(meta)];
  const sorted = [...hours].sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  const money = (v: number): string => `${esc(v.toFixed(2))} ${esc(currency)}`;

  let totalHours = 0;
  let totalMoney = 0;

  const bodyRows = sorted
    .map((r) => {
      const isVacation = r.vacationDays >= 1;
      const isDisease = r.diseaseDays >= 1;
      const isAttendance = !isVacation && !isDisease;
      const typeLabel = isVacation ? L.vacation : isDisease ? L.disease : L.attendance;

      const rowHours = isAttendance ? r.totalHours : 0;
      const lineTotal = isAttendance ? rowHours * hourlyWage : 0;
      totalHours += rowHours;
      totalMoney += lineTotal;

      const hoursCell = isAttendance ? esc(rowHours.toFixed(1)) : '—';
      const priceCell = isAttendance ? money(hourlyWage) : '—';
      const lineCell = isAttendance ? money(lineTotal) : '—';

      return `<tr>
  <td>${esc(r.periodStart)}</td>
  <td class="num">${hoursCell}</td>
  <td>${esc(typeLabel)}</td>
  <td class="num">${priceCell}</td>
  <td class="num">${lineCell}</td>
</tr>`;
    })
    .join('\n');

  // Reconcile note only when the summed line totals match gross (flat-hourly
  // case). For fixed-monthly the Gross line stays authoritative and no claim of
  // equality is made — mirrors the on-screen behaviour.
  const reconciles = Math.abs(totalMoney - gross) < 0.005;
  const note = reconciles ? `<p class="reconcile">${esc(L.reconcileNote)}</p>` : '';

  return `
<h2 class="section-title">${esc(L.section)}</h2>
<table class="hours">
  <thead>
    <tr>
      <th>${esc(L.date)}</th>
      <th class="num">${esc(L.hours)}</th>
      <th>${esc(L.type)}</th>
      <th class="num">${esc(L.hourlyPrice)}</th>
      <th class="num">${esc(L.lineTotal)}</th>
    </tr>
  </thead>
  <tbody>
${bodyRows}
  </tbody>
  <tfoot>
    <tr>
      <td>${esc(L.total)}</td>
      <td class="num">${esc(totalHours.toFixed(1))}</td>
      <td></td>
      <td></td>
      <td class="num">${money(totalMoney)}</td>
    </tr>
  </tfoot>
</table>
${note}`;
}

/**
 * NET WAGE (נטו) deductions + net section for the payslip. Renders under the Gross
 * line: a DEDUCTIONS heading, a Loans (−loansTotal) row, an Advances (−advancesTotal)
 * row, and a prominent NET line. RECONCILES: net === gross − loans − advances.
 *
 * The section only renders when the service provided net data (result.net !== undefined
 * — the single-calc path always does; the batch/dashboard path does not). NET is shown
 * as the REAL number and CAN be negative — a negative net gets a highlight class.
 */
function deductionsSectionHtml(meta: ReportHeaderMeta, result: SalaryResult): string {
  if (result.net === undefined) return '';
  const L = HOURS_LABELS[hoursLangFor(meta)];
  const loans = result.loansTotal ?? 0;
  const advances = result.advancesTotal ?? 0;
  const cur = esc(result.currency);
  const money = (v: number): string => `${esc(v.toFixed(2))} ${cur}`;
  // Deductions shown as negatives (money reduced).
  const neg = (v: number): string => `-${esc(v.toFixed(2))} ${cur}`;
  const negative = result.net < 0;
  return `
<h2 class="section-title">${esc(L.deductions)}</h2>
<div class="row"><span>${esc(L.loans)}</span><span class="deduction">${neg(loans)}</span></div>
<div class="row"><span>${esc(L.advances)}</span><span class="deduction">${neg(advances)}</span></div>
<div class="net${negative ? ' negative' : ''}"><span class="bold">${esc(L.net)}</span><span class="bold">${money(result.net)}</span></div>`;
}

/** Payslip HTML (mirror of PayslipDocument). */
export function payslipHtml(props: {
  meta: ReportHeaderMeta;
  workerName: string;
  result: SalaryResult;
  warnings: string[];
  /** Per-DAY working-hours aggregate (grain='DAY') for the breakdown table. */
  hours?: WorkingHours[];
  /** Resolved hourly rate the calc used (result.hourlyWage). */
  hourlyWage?: number;
}): string {
  const { meta, workerName, result, warnings, hours, hourlyWage } = props;
  const lines = result.breakdown
    .map((l) => rowHtml(esc(l.label), `${esc(l.amount.toFixed(2))} ${esc(result.currency)}`))
    .join('\n');
  const warns = warnings
    .map((w) => `<p class="warn">⚠ ${esc(w)}</p>`)
    .join('\n');
  const hoursSection = workingHoursSectionHtml(
    meta,
    hours ?? [],
    hourlyWage ?? result.hourlyWage,
    result.currency,
    result.gross,
  );
  const deductionsSection = deductionsSectionHtml(meta, result);
  const L = HOURS_LABELS[hoursLangFor(meta)];
  const body = `
<p class="bold">Worker: ${esc(workerName)}</p>
<p class="meta">Mode: ${esc(result.mode)}  ·  Engine: ${esc(result.engineVersion)}</p>
<div>${lines}</div>
${hoursSection}
<div class="total"><span class="bold">${esc(L.gross)}</span><span class="bold">${esc(result.gross.toFixed(2))} ${esc(result.currency)}</span></div>
${deductionsSection}
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
