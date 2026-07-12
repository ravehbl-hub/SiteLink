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
import type { SalaryResult } from '@sitelink/shared';

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
}): React.ReactElement<DocumentProps> {
  const { meta, workerName, result, warnings } = props;
  const lines = result.breakdown.map((l, i) =>
    e(View, { key: `l${i}`, style: styles.row }, [
      e(Text, { key: 'lbl' }, l.label),
      e(Text, { key: 'amt' }, `${l.amount.toFixed(2)} ${result.currency}`),
    ]),
  );
  return e(
    Document,
    {},
    e(Page, { size: 'A4', style: styles.page }, [
      header(meta),
      e(Text, { key: 'w', style: styles.bold }, `Worker: ${workerName}`),
      e(Text, { key: 'mode', style: styles.meta }, `Mode: ${result.mode}  ·  Engine: ${result.engineVersion}`),
      e(View, { key: 'lines' }, lines),
      e(View, { key: 'g', style: styles.total }, [
        e(Text, { key: 'gl', style: styles.bold }, 'Gross'),
        e(Text, { key: 'gv', style: styles.bold }, `${result.gross.toFixed(2)} ${result.currency}`),
      ]),
      ...warnings.map((w, i) => e(Text, { key: `warn${i}`, style: styles.warn }, `⚠ ${w}`)),
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
