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
});

export interface ReportHeaderMeta {
  title: string;
  siteName?: string;
  from: string;
  to: string;
  direction: 'ltr' | 'rtl';
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
}): React.ReactElement<DocumentProps> {
  const { meta, workerName, result, warnings, hours, hourlyWage } = props;
  const rate = hourlyWage ?? result.hourlyWage;
  const lines = result.breakdown.map((l, i) =>
    e(View, { key: `l${i}`, style: styles.row }, [
      e(Text, { key: 'lbl' }, l.label),
      e(Text, { key: 'amt' }, `${l.amount.toFixed(2)} ${result.currency}`),
    ]),
  );
  const hoursSection = hoursBreakdown(hours ?? [], rate, result.currency);
  return e(
    Document,
    {},
    e(Page, { size: 'A4', style: styles.page }, [
      header(meta),
      e(Text, { key: 'w', style: styles.bold }, `Worker: ${workerName}`),
      e(Text, { key: 'mode', style: styles.meta }, `Mode: ${result.mode}  ·  Engine: ${result.engineVersion}`),
      e(View, { key: 'lines' }, lines),
      ...(hoursSection ? [hoursSection] : []),
      e(View, { key: 'g', style: styles.total }, [
        e(Text, { key: 'gl', style: styles.bold }, 'Gross'),
        e(Text, { key: 'gv', style: styles.bold }, `${result.gross.toFixed(2)} ${result.currency}`),
      ]),
      ...warnings.map((w, i) => e(Text, { key: `warn${i}`, style: styles.warn }, `⚠ ${w}`)),
    ]),
  );
}

/**
 * Working-hours breakdown block for the react-pdf payslip fallback (parity with
 * the HTML/CloudConvert template). Per-DAY rows DATE | HOURS | TYPE | HOURLY
 * PRICE | LINE TOTAL + a TOTAL row; LINE TOTAL = totalHours × rate for
 * ATTENDANCE, '—' otherwise. Kept minimal (English labels; the RTL-critical
 * Hebrew rendering path is CloudConvert/HTML, which is active).
 */
function hoursBreakdown(
  hours: WorkingHours[],
  rate: number,
  currency: string,
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
      e(Text, { key: 'p' }, isAttendance ? money(rate) : '—'),
      e(Text, { key: 'lt' }, isAttendance ? money(lineTotal) : '—'),
    ]);
  });
  return e(View, { key: 'hoursSection' }, [
    e(Text, { key: 'ht', style: styles.bold }, 'Working hours details'),
    ...rows,
    e(View, { key: 'htot', style: styles.total }, [
      e(Text, { key: 'l', style: styles.bold }, `Total  ${totalHours.toFixed(1)}h`),
      e(Text, { key: 'v', style: styles.bold }, money(totalMoney)),
    ]),
  ]);
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
