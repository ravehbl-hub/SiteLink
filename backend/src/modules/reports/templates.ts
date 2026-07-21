/**
 * SiteLink back end — PDF templates (Architecture §7, FR-X-PDF).
 *
 * Built with @react-pdf/renderer. We use React.createElement directly (no JSX) so
 * the back-end tsconfig needs no JSX pragma. Every report header carries the title,
 * date range and generation timestamp (FR-X-PDF-3); `dir` honors RTL/LTR.
 */
import React from 'react';
import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  type DocumentProps,
} from '@react-pdf/renderer';
import type { ProfitLoss, SalaryResult, WorkingHours } from '@sitelink/shared';

const e = React.createElement;

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 11, fontFamily: 'Helvetica' },
  header: { marginBottom: 16, borderBottom: 1, paddingBottom: 8 },
  title: { fontSize: 18, marginBottom: 4 },
  meta: { fontSize: 9, color: '#555' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
    borderBottom: 0.5,
    borderColor: '#ddd',
  },
  total: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  bold: { fontWeight: 'bold' },
  warn: { marginTop: 12, fontSize: 9, color: '#a00' },
  sectionTitle: { fontSize: 13, fontWeight: 'bold', marginTop: 16, marginBottom: 6 },
  deduction: { color: '#a00' },
  net: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    borderTop: 1,
    paddingTop: 6,
    fontSize: 14,
  },
});

export interface ReportHeaderMeta {
  title: string;
  siteName?: string;
  from: string;
  to: string;
  direction: 'ltr' | 'rtl';
  /**
   * Specific locale ('he' | 'en' | 'tr'). `direction` alone can't distinguish en
   * from tr (both LTR), so templates that localize labels (e.g. the payslip
   * working-hours section) read `lang` to pick the exact locale. Optional — when
   * absent, templates fall back to he for rtl / en for ltr.
   */
  lang?: 'he' | 'en' | 'tr';
}

function header(meta: ReportHeaderMeta): React.ReactElement {
  return e(View, { style: styles.header }, [
    e(Text, { key: 't', style: styles.title }, meta.title),
    e(
      Text,
      { key: 'm', style: styles.meta },
      `${meta.siteName ? `Site: ${meta.siteName}  ·  ` : ''}Period: ${meta.from} → ${meta.to}  ·  Generated: ${new Date().toISOString()}`,
    ),
  ]);
}

/** Payslip PDF from a SalaryResult (FR-X-PDF-1). */
export function PayslipDocument(props: {
  meta: ReportHeaderMeta;
  workerName: string;
  result: SalaryResult;
  warnings: string[];
  /** Per-DAY working-hours aggregate for the breakdown table (parity w/ HTML). */
  hours?: WorkingHours[];
  /** Resolved hourly rate (result.hourlyWage). */
  hourlyWage?: number;
  /**
   * HOURS-ONLY toggle (default false). false → OMIT all money (breakdown lines,
   * hours-table price/line-total columns, Gross, Deductions, Net). true → full.
   */
  includePrices?: boolean;
}): React.ReactElement<DocumentProps> {
  const { meta, workerName, result, warnings, hours, hourlyWage } = props;
  const includePrices = props.includePrices ?? false;
  const rate = hourlyWage ?? result.hourlyWage;
  const lines = includePrices
    ? result.breakdown.map((l, i) =>
        e(View, { key: `l${i}`, style: styles.row }, [
          e(Text, { key: 'lbl' }, l.label),
          e(Text, { key: 'amt' }, `${l.amount.toFixed(2)} ${result.currency}`),
        ]),
      )
    : [];
  const hoursSection = hoursBreakdown(hours ?? [], rate, result.currency, includePrices);
  return e(
    Document,
    {},
    e(Page, { size: 'A4', style: styles.page }, [
      header(meta),
      e(Text, { key: 'w', style: styles.bold }, `Worker: ${workerName}`),
      e(Text, { key: 'mode', style: styles.meta }, `Mode: ${result.mode}  ·  Engine: ${result.engineVersion}`),
      ...(includePrices ? [e(View, { key: 'lines' }, lines)] : []),
      ...(hoursSection ? [hoursSection] : []),
      // Gross / Deductions / Net only when prices are included (HOURS-ONLY = none).
      ...(includePrices
        ? [
            ...splitBlock(result),
            e(View, { key: 'g', style: styles.total }, [
              e(Text, { key: 'gl', style: styles.bold }, 'Gross'),
              e(Text, { key: 'gv', style: styles.bold }, `${result.gross.toFixed(2)} ${result.currency}`),
            ]),
            ...deductionsBlock(result),
          ]
        : []),
      ...warnings.map((w, i) => e(Text, { key: `warn${i}`, style: styles.warn }, `⚠ ${w}`)),
    ]),
  );
}

/**
 * Working-hours breakdown block for the react-pdf payslip fallback (parity with
 * the HTML/CloudConvert template). When `includePrices` is true: per-DAY rows
 * DATE | HOURS | TYPE | HOURLY PRICE | LINE TOTAL + a money TOTAL row (LINE TOTAL
 * = totalHours × rate for ATTENDANCE, '—' otherwise). When false (DEFAULT,
 * HOURS-ONLY): rows DATE | HOURS | TYPE and a total-hours-only row — no money.
 * Kept minimal (English labels; the RTL-critical Hebrew path is CloudConvert/HTML).
 */
function hoursBreakdown(
  hours: WorkingHours[],
  rate: number,
  currency: string,
  includePrices: boolean,
): React.ReactElement | null {
  if (!hours.length) return null;
  const sorted = [...hours].sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  const money = (v: number): string => `${v.toFixed(2)} ${currency}`;
  let totalHours = 0;
  let totalMoney = 0;
  const rows = sorted.map((r, i) => {
    const isVacation = r.vacationDays >= 1;
    const isDisease = r.diseaseDays >= 1;
    const isAttendance = !isVacation && !isDisease;
    const type = isVacation ? 'Vacation' : isDisease ? 'Disease' : 'Attendance';
    const rowHours = isAttendance ? r.totalHours : 0;
    const lineTotal = isAttendance ? rowHours * rate : 0;
    totalHours += rowHours;
    totalMoney += lineTotal;
    return e(View, { key: `hr${i}`, style: styles.row }, [
      e(Text, { key: 'd' }, r.periodStart),
      e(Text, { key: 'h' }, isAttendance ? rowHours.toFixed(1) : '—'),
      e(Text, { key: 't' }, type),
      ...(includePrices
        ? [
            e(Text, { key: 'p' }, isAttendance ? money(rate) : '—'),
            e(Text, { key: 'lt' }, isAttendance ? money(lineTotal) : '—'),
          ]
        : []),
    ]);
  });
  return e(View, { key: 'hoursSection' }, [
    e(Text, { key: 'ht', style: styles.bold }, 'Working hours details'),
    ...rows,
    e(View, { key: 'htot', style: styles.total }, [
      e(Text, { key: 'l', style: styles.bold }, `Total  ${totalHours.toFixed(1)}h`),
      ...(includePrices ? [e(Text, { key: 'v', style: styles.bold }, money(totalMoney))] : []),
    ]),
  ]);
}

/**
 * HOURS-SPLIT PAYMENT block for the react-pdf payslip fallback (parity with the
 * HTML/CloudConvert template). Renders a Personnel line + a Contractor line
 * (hrs × rate → amount) + a combined total, only when the calc enabled split
 * (result.split?.enabled). Money-bearing → the caller only emits it when
 * includePrices is true. English labels (the RTL/Hebrew path is HTML/CloudConvert).
 */
function splitBlock(result: SalaryResult): React.ReactElement[] {
  const s = result.split;
  if (!s?.enabled) return [];
  const cur = result.currency;
  const money = (v: number): string => `${v.toFixed(2)} ${cur}`;
  const rate = (hrs: number, r: number): string => `${hrs.toFixed(1)}h × ${r.toFixed(2)}`;
  return [
    e(Text, { key: 'stitle', style: styles.sectionTitle }, `Hours split (threshold ${s.threshold})`),
    e(View, { key: 'sper', style: styles.row }, [
      e(Text, { key: 'l' }, `Personnel  ${rate(s.personnelHours, s.personnelRate)}`),
      e(Text, { key: 'v' }, money(s.personnelAmount)),
    ]),
    e(View, { key: 'scon', style: styles.row }, [
      e(Text, { key: 'l' }, `Contractor  ${rate(s.contractorHours, s.contractorRate)}`),
      e(Text, { key: 'v' }, money(s.contractorAmount)),
    ]),
    e(View, { key: 'stot', style: styles.total }, [
      e(Text, { key: 'l', style: styles.bold }, 'Split total'),
      e(Text, { key: 'v', style: styles.bold }, money(s.personnelAmount + s.contractorAmount)),
    ]),
  ];
}

/**
 * NET WAGE (נטו) deductions + net block for the react-pdf payslip (parity with the
 * HTML/CloudConvert template). Only renders when the service supplied net data
 * (result.net !== undefined). NET === gross − loans − advances and is the REAL
 * number (may be negative — English labels here; the RTL/Hebrew path is HTML).
 */
function deductionsBlock(result: SalaryResult): React.ReactElement[] {
  if (result.net === undefined) return [];
  const loans = result.loansTotal ?? 0;
  const advances = result.advancesTotal ?? 0;
  const cur = result.currency;
  return [
    e(Text, { key: 'dtitle', style: styles.sectionTitle }, 'Deductions'),
    e(View, { key: 'dloans', style: styles.row }, [
      e(Text, { key: 'l' }, 'Loans'),
      e(Text, { key: 'v', style: styles.deduction }, `-${loans.toFixed(2)} ${cur}`),
    ]),
    e(View, { key: 'dadv', style: styles.row }, [
      e(Text, { key: 'l' }, 'Advances'),
      e(Text, { key: 'v', style: styles.deduction }, `-${advances.toFixed(2)} ${cur}`),
    ]),
    e(View, { key: 'dnet', style: styles.net }, [
      e(Text, { key: 'l', style: styles.bold }, 'Net'),
      e(Text, { key: 'v', style: styles.bold }, `${result.net.toFixed(2)} ${cur}`),
    ]),
  ];
}

/** Profit & Loss PDF from a computed ProfitLoss (FR-MGR-PNL / SM-6). */
export function ProfitLossDocument(props: {
  meta: ReportHeaderMeta;
  pnl: ProfitLoss;
}): React.ReactElement<DocumentProps> {
  const { meta, pnl } = props;
  const money = (v: number): string => `${v.toFixed(2)} ${pnl.currency}`;
  const lines: Array<[string, number]> = [
    ['Revenue', pnl.revenue],
    ['Salary cost', pnl.salaryCost],
    ['Loans cost', pnl.loansCost],
    ['Advances cost', pnl.advancesCost],
    ['Other cost', pnl.otherCost],
  ];
  const body = lines.map(([label, amount], i) =>
    e(View, { key: `p${i}`, style: styles.row }, [
      e(Text, { key: 'lbl' }, label),
      e(Text, { key: 'amt' }, money(amount)),
    ]),
  );
  return e(
    Document,
    {},
    e(Page, { size: 'A4', style: styles.page }, [
      header(meta),
      e(View, { key: 'body' }, body),
      e(View, { key: 'net', style: styles.total }, [
        e(Text, { key: 'nl', style: styles.bold }, 'Net profit'),
        e(Text, { key: 'nv', style: styles.bold }, money(pnl.netProfit)),
      ]),
    ]),
  );
}

/**
 * Working Hours PDF for a single worker (FR-WRK-1). Rows are the derived
 * `WorkingHours` buckets (day/week/month per `grain`) already aggregated by the
 * attendance service — this template only lays them out (RTL/LTR via header()).
 */
export function WorkingHoursDocument(props: {
  meta: ReportHeaderMeta;
  workerName: string;
  grain: WorkingHours['grain'];
  rows: WorkingHours[];
}): React.ReactElement<DocumentProps> {
  const { meta, workerName, grain, rows } = props;
  const sorted = [...rows].sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  const totalHours = sorted.reduce((sum, r) => sum + r.totalHours, 0);
  const body = sorted.map((r, i) =>
    e(View, { key: `h${i}`, style: styles.row }, [
      e(Text, { key: 'p' }, r.periodStart === r.periodEnd ? r.periodStart : `${r.periodStart} → ${r.periodEnd}`),
      e(
        Text,
        { key: 'v' },
        `H:${r.totalHours.toFixed(1)}  A:${r.attendanceDays}  V:${r.vacationDays}  D:${r.diseaseDays}`,
      ),
    ]),
  );
  return e(
    Document,
    {},
    e(Page, { size: 'A4', style: styles.page }, [
      header(meta),
      e(Text, { key: 'w', style: styles.bold }, `Worker: ${workerName}`),
      e(Text, { key: 'g', style: styles.meta }, `Grain: ${grain}`),
      e(View, { key: 'body' }, body),
      e(View, { key: 'total', style: styles.total }, [
        e(Text, { key: 'tl', style: styles.bold }, 'Total hours'),
        e(Text, { key: 'tv', style: styles.bold }, totalHours.toFixed(1)),
      ]),
    ]),
  );
}

/**
 * One worker's line in the payroll batch ("All workers") report — the same fields
 * the manager salary table renders, with the worker name joined in by the service.
 */
export interface PayrollBatchRowView {
  workerName: string;
  totalHours: number;
  hourlyWage: number;
  gross: number;
  deductionsTotal: number;
  net: number;
  currency: string;
  /** 'fixed' calc → the hour price is informational (gross ≠ rate × hours). */
  isMonthly: boolean;
}

/**
 * PAYROLL BATCH PDF (react-pdf fallback; the RTL/Hebrew-critical path is the HTML/
 * CloudConvert `payrollBatchHtml`). English labels here — kept minimal, parity with
 * the columns the on-screen table shows: Worker · Hours · Hour price · Gross ·
 * Deductions · Net. A fixed-monthly row's price carries a '*' marker.
 */
export function PayrollBatchDocument(props: {
  meta: ReportHeaderMeta;
  rows: PayrollBatchRowView[];
}): React.ReactElement<DocumentProps> {
  const { meta, rows } = props;
  const money = (v: number, cur: string): string => `${v.toFixed(2)} ${cur}`;
  const body = rows.map((r, i) =>
    e(View, { key: `r${i}`, style: styles.row }, [
      e(Text, { key: 'n' }, r.workerName),
      e(
        Text,
        { key: 'v' },
        `${r.totalHours}h  ·  ${money(r.hourlyWage, r.currency)}${r.isMonthly ? '*' : ''}  ·  ${money(r.gross, r.currency)}  ·  -${money(r.deductionsTotal, r.currency)}  ·  ${money(r.net, r.currency)}`,
      ),
    ]),
  );
  const anyMonthly = rows.some((r) => r.isMonthly);
  return e(
    Document,
    {},
    e(Page, { size: 'A4', style: styles.page }, [
      header(meta),
      e(Text, { key: 'hdr', style: styles.meta }, 'Worker · Hours · Hour price · Gross · Deductions · Net'),
      e(View, { key: 'body' }, body),
      ...(anyMonthly
        ? [e(Text, { key: 'legend', style: styles.meta }, '* rate is informational for monthly-salary workers')]
        : []),
    ]),
  );
}

export interface AttendanceSummaryRow {
  workerName: string;
  attendanceDays: number;
  vacationDays: number;
  diseaseDays: number;
  totalHours: number;
}

/** Attendance summary PDF (FR-X-PDF-1). */
export function AttendanceSummaryDocument(props: {
  meta: ReportHeaderMeta;
  rows: AttendanceSummaryRow[];
}): React.ReactElement<DocumentProps> {
  const { meta, rows } = props;
  const body = rows.map((r, i) =>
    e(View, { key: `r${i}`, style: styles.row }, [
      e(Text, { key: 'n' }, r.workerName),
      e(
        Text,
        { key: 'v' },
        `A:${r.attendanceDays}  V:${r.vacationDays}  D:${r.diseaseDays}  H:${r.totalHours.toFixed(1)}`,
      ),
    ]),
  );
  return e(
    Document,
    {},
    e(Page, { size: 'A4', style: styles.page }, [
      header(meta),
      e(View, { key: 'body' }, body),
    ]),
  );
}
