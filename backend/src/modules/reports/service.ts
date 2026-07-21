/**
 * SiteLink back end — reports service (FR-X-PDF). Renders templates to a PDF buffer.
 */
import { renderToBuffer } from '@react-pdf/renderer';
import type { ReactElement } from 'react';
import type { DocumentProps } from '@react-pdf/renderer';
import { prisma } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { toDateOnly } from '../../lib/dates.js';
import { toNumber } from '../../lib/money.js';
import { assertCompanyScopeMatch, companyWhere, type CompanyScope } from '../../lib/scope.js';
import { loadConfig } from '../../config.js';
import { CloudConvertService } from '../../lib/cloudconvert.js';
import { AttendanceType } from '@sitelink/shared';
import type { WorkingHoursGrain } from '@sitelink/shared';
import { SalaryService } from '../salary/service.js';
import { FinanceService } from '../finance/service.js';
import { AttendanceService } from '../attendance/service.js';
import {
  AttendanceSummaryDocument,
  PayrollBatchDocument,
  PayslipDocument,
  ProfitLossDocument,
  WorkingHoursDocument,
  type AttendanceSummaryRow,
  type PayrollBatchRowView,
  type ReportHeaderMeta,
} from './templates.js';
import {
  attendanceSummaryHtml,
  payrollBatchHtml,
  payslipHtml,
  profitLossHtml,
  workingHoursHtml,
} from './html-templates.js';
import type { AuthUser } from '../../plugins/types.js';

/**
 * Neutralize spreadsheet formula injection for a text cell (OWASP CSV-injection
 * defense). If the value begins with a formula trigger (`= + - @`, tab or CR) a
 * leading apostrophe forces the sheet app to treat it as a literal string, never
 * evaluate it. Applied to the only attacker-influenceable text in the xlsx export
 * (the worker name); numeric cells are pushed as numbers and are unaffected.
 * Exported for unit testing.
 */
export function sanitizeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export class ReportsService {
  /**
   * MULTI-TENANCY (P2): assert a worker is inside the caller's company (404 otherwise —
   * a manager can never render another company's worker's payslip/working-hours PDF, and
   * no signed URL is ever minted for a cross-company worker). Returns the worker row.
   */
  private async assertWorkerCompany(
    workerId: string,
    companyScope?: CompanyScope,
  ): Promise<void> {
    if (!companyScope) return;
    const w = await prisma.worker.findUnique({
      where: { id: workerId },
      select: { companyId: true },
    });
    assertCompanyScopeMatch(companyScope, w?.companyId);
  }

  /** P2: assert a site (when supplied) is inside the caller's company (404 else). */
  private async assertSiteCompany(
    siteId: string | undefined,
    companyScope?: CompanyScope,
  ): Promise<void> {
    if (!companyScope || !siteId) return;
    const s = await prisma.site.findUnique({
      where: { id: siteId },
      select: { companyId: true },
    });
    assertCompanyScopeMatch(companyScope, s?.companyId);
  }

  /**
   * CloudConvert client, lazily constructed only when CLOUDCONVERT_API_KEY is
   * present. `null` => env-gate OFF => fall back to the in-process @react-pdf
   * renderer (unchanged behaviour, keeps local/dev/CI green without the key).
   */
  private readonly cloudConvert: CloudConvertService | null;

  constructor(
    private readonly salary = new SalaryService(),
    private readonly finance = new FinanceService(),
    private readonly attendance = new AttendanceService(),
  ) {
    const apiKey = loadConfig().CLOUDCONVERT_API_KEY;
    this.cloudConvert = apiKey ? new CloudConvertService(apiKey) : null;
  }

  /**
   * Single switch point for the two render paths. When the CloudConvert key is
   * present, render the HTML producer through CloudConvert (HTML→PDF); otherwise
   * fall back to the @react-pdf document. Both return identical Buffer contracts
   * (`%PDF-` bytes) so the endpoints are unaffected either way.
   */
  private renderPdf(
    html: () => string,
    reactDoc: () => ReactElement<DocumentProps>,
    filename: string,
  ): Promise<Buffer> {
    if (this.cloudConvert) {
      return this.cloudConvert.htmlToPdf(html(), { filename });
    }
    return renderToBuffer(reactDoc());
  }

  async payslipPdf(
    params: {
      workerId: string;
      siteId?: string;
      from: string;
      to: string;
      direction: 'ltr' | 'rtl';
      lang?: 'he' | 'en' | 'tr';
      /**
       * HOURS-ONLY toggle. Default false → render a money-free slip (per-day
       * date|hours|type + total hours only; no hourly price / line totals /
       * gross / deductions / net). true → the full payslip.
       */
      includePrices?: boolean;
    },
    companyScope?: CompanyScope,
  ): Promise<Buffer> {
    // P2: cross-company worker/site → 404 BEFORE any query/render.
    await this.assertWorkerCompany(params.workerId, companyScope);
    await this.assertSiteCompany(params.siteId, companyScope);
    const worker = await prisma.worker.findUnique({ where: { id: params.workerId } });
    if (!worker) throw AppError.notFound('Worker not found');

    const result = await this.salary.calculate({
      workerId: params.workerId,
      siteId: params.siteId,
      periodStart: params.from,
      periodEnd: params.to,
    });

    // Per-DAY working-hours aggregate — the SAME /working-hours derivation the
    // on-screen "Working hours details" section uses (as workingHoursPdf does).
    // `workerId` is ALREADY the resolved id (route-forced), so we call caller-less:
    // identity is settled and the query filter is trusted (no re-scoping).
    const hours = await this.attendance.workingHours({
      workerId: params.workerId,
      siteId: params.siteId,
      from: params.from,
      to: params.to,
      grain: 'DAY',
    });

    const meta: ReportHeaderMeta = {
      title: 'Payslip',
      from: toDateOnly(new Date(params.from)),
      to: toDateOnly(new Date(params.to)),
      direction: params.direction,
      lang: params.lang,
    };

    const workerName = `${worker.firstName} ${worker.lastName}`;
    const data = {
      meta,
      workerName,
      result,
      warnings: result.warnings,
      hours,
      hourlyWage: result.hourlyWage,
      // Default false → HOURS-ONLY (no money anywhere).
      includePrices: params.includePrices ?? false,
    };
    return this.renderPdf(
      () => payslipHtml(data),
      () => PayslipDocument(data),
      'payslip',
    );
  }

  async workingHoursPdf(
    params: {
      workerId: string;
      siteId?: string;
      from: string;
      to: string;
      grain: WorkingHoursGrain;
      direction: 'ltr' | 'rtl';
    },
    companyScope?: CompanyScope,
  ): Promise<Buffer> {
    await this.assertWorkerCompany(params.workerId, companyScope);
    await this.assertSiteCompany(params.siteId, companyScope);
    const worker = await prisma.worker.findUnique({ where: { id: params.workerId } });
    if (!worker) throw AppError.notFound('Worker not found');

    // Reuse the derived aggregate the /working-hours endpoint uses — do NOT
    // duplicate bucketing here. `workerId` is ALREADY the route-forced id (WORKER
    // self, or Manager-supplied), so we call caller-less: identity is settled and
    // the query filter is trusted (no re-scoping needed).
    const rows = await this.attendance.workingHours({
      workerId: params.workerId,
      siteId: params.siteId,
      from: params.from,
      to: params.to,
      grain: params.grain,
    });

    const meta: ReportHeaderMeta = {
      title: 'Working Hours',
      from: toDateOnly(new Date(params.from)),
      to: toDateOnly(new Date(params.to)),
      direction: params.direction,
    };

    const data = {
      meta,
      workerName: `${worker.firstName} ${worker.lastName}`,
      grain: params.grain,
      rows,
    };
    return this.renderPdf(
      () => workingHoursHtml(data),
      () => WorkingHoursDocument(data),
      'working-hours',
    );
  }

  async attendanceSummaryPdf(
    params: {
      siteId?: string;
      from: string;
      to: string;
      direction: 'ltr' | 'rtl';
    },
    companyScope?: CompanyScope,
  ): Promise<Buffer> {
    // P2: cross-company site → 404; the attendance query is company-scoped so the
    // summary NEVER sums another tenant's rows (AttendanceRecord has a direct companyId).
    await this.assertSiteCompany(params.siteId, companyScope);
    const companyClause = companyScope ? companyWhere(companyScope) : {};
    const from = new Date(params.from);
    const to = new Date(params.to);

    const records = await prisma.attendanceRecord.findMany({
      where: {
        ...companyClause,
        date: { gte: from, lte: to },
        ...(params.siteId ? { siteId: params.siteId } : {}),
      },
      include: { worker: { select: { firstName: true, lastName: true } } },
    });

    const byWorker = new Map<string, AttendanceSummaryRow>();
    for (const r of records) {
      const name = `${r.worker.firstName} ${r.worker.lastName}`;
      const row =
        byWorker.get(r.workerId) ??
        {
          workerName: name,
          attendanceDays: 0,
          vacationDays: 0,
          diseaseDays: 0,
          totalHours: 0,
        };
      if (r.type === AttendanceType.ATTENDANCE) {
        row.attendanceDays += 1;
        row.totalHours += toNumber(r.hours);
      } else if (r.type === AttendanceType.VACATION) {
        row.vacationDays += 1;
      } else {
        row.diseaseDays += 1;
      }
      byWorker.set(r.workerId, row);
    }

    let siteName: string | undefined;
    if (params.siteId) {
      const site = await prisma.site.findUnique({
        where: { id: params.siteId },
        select: { name: true },
      });
      siteName = site?.name;
    }

    const meta: ReportHeaderMeta = {
      title: 'Attendance Summary',
      siteName,
      from: toDateOnly(from),
      to: toDateOnly(to),
      direction: params.direction,
    };

    const data = { meta, rows: [...byWorker.values()] };
    return this.renderPdf(
      () => attendanceSummaryHtml(data),
      () => AttendanceSummaryDocument(data),
      'attendance',
    );
  }

  async profitLossPdf(
    params: {
      siteId?: string;
      from: string;
      to: string;
      revenue: number;
      currency: string;
      direction: 'ltr' | 'rtl';
    },
    companyScope?: CompanyScope,
  ): Promise<Buffer> {
    await this.assertSiteCompany(params.siteId, companyScope);
    // Reuse the existing on-demand P&L computation (company-scoped) — do not duplicate.
    const pnl = await this.finance.profitLoss(
      {
        siteId: params.siteId,
        from: params.from,
        to: params.to,
        revenue: params.revenue,
        currency: params.currency,
      },
      companyScope,
    );

    let siteName: string | undefined;
    if (params.siteId) {
      const site = await prisma.site.findUnique({
        where: { id: params.siteId },
        select: { name: true },
      });
      siteName = site?.name;
    }

    const meta: ReportHeaderMeta = {
      title: 'Profit & Loss',
      siteName,
      from: toDateOnly(new Date(params.from)),
      to: toDateOnly(new Date(params.to)),
      direction: params.direction,
    };

    const data = { meta, pnl };
    return this.renderPdf(
      () => profitLossHtml(data),
      () => ProfitLossDocument(data),
      'profit-loss',
    );
  }

  /**
   * PAYROLL BATCH ("All workers") — the report/export analogue of the manager salary
   * batch TABLE. It reuses `SalaryService.calculateAll(period, caller)` verbatim, so
   * every PDF/Excel/share row is byte-for-byte the same roll-up the on-screen table
   * shows (same flat/hourly + fixed calc, same company scope resolved server-side from
   * the CALLER — a MANAGER only ever sees their OWN company's workers; an ADMIN may
   * narrow via period.companyId). Worker NAMES are joined here (SalaryBatchRow carries
   * only workerId); the name lookup is HARD-scoped to the produced workerId set, so no
   * cross-tenant name can leak in. Highest-sensitivity payroll data — the CALLER-derived
   * scope is the single source of truth; no client-supplied company/site is trusted.
   */
  private async loadPayrollBatch(
    period: { from: string; to: string; companyId?: string },
    caller: AuthUser,
  ): Promise<{ rows: PayrollBatchRowView[]; skippedCount: number }> {
    const batch = await this.salary.calculateAll(
      {
        periodStart: period.from,
        periodEnd: period.to,
        companyId: period.companyId,
      },
      caller,
    );

    // Join names for ONLY the workerIds the (already company-scoped) batch produced.
    const ids = batch.rows.map((r) => r.workerId);
    const workers = ids.length
      ? await prisma.worker.findMany({
          where: { id: { in: ids } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const nameById = new Map(
      workers.map((w) => [w.id, `${w.firstName} ${w.lastName}`.trim()]),
    );

    const rows: PayrollBatchRowView[] = batch.rows.map((r) => ({
      workerName: nameById.get(r.workerId) ?? r.workerId,
      totalHours: r.totalHours,
      hourlyWage: r.hourlyWage,
      gross: r.gross,
      deductionsTotal: r.deductionsTotal,
      net: r.net,
      currency: r.currency,
      isMonthly: r.mode === 'fixed',
    }));

    return { rows, skippedCount: batch.skippedCount };
  }

  async payrollBatchPdf(
    period: { from: string; to: string; direction: 'ltr' | 'rtl'; lang?: 'he' | 'en' | 'tr'; companyId?: string },
    caller: AuthUser,
  ): Promise<Buffer> {
    const { rows } = await this.loadPayrollBatch(period, caller);
    const meta: ReportHeaderMeta = {
      title: 'Payroll',
      from: toDateOnly(new Date(period.from)),
      to: toDateOnly(new Date(period.to)),
      direction: period.direction,
      lang: period.lang,
    };
    const data = { meta, rows };
    return this.renderPdf(
      () => payrollBatchHtml(data),
      () => PayrollBatchDocument(data),
      'payroll-batch',
    );
  }

  /**
   * PAYROLL BATCH as a real .xlsx (exceljs) — one sheet, the 7 columns in table order
   * plus a header row; money columns number-formatted. Same rows as the PDF/table.
   * Returns the workbook bytes as a Buffer for the route to stream as an attachment.
   */
  async payrollBatchXlsx(
    period: { from: string; to: string; lang?: 'he' | 'en' | 'tr'; companyId?: string },
    caller: AuthUser,
  ): Promise<Buffer> {
    const { rows } = await this.loadPayrollBatch(period, caller);
    // Lazy import keeps exceljs out of the module graph until an export is requested.
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = 'SiteLink';
    wb.created = new Date();
    const ws = wb.addWorksheet('Payroll');

    const periodLabel = `${toDateOnly(new Date(period.from))} → ${toDateOnly(new Date(period.to))}`;
    ws.columns = [
      { header: 'Worker', key: 'worker', width: 28 },
      { header: 'Period', key: 'period', width: 24 },
      { header: 'Work hours', key: 'hours', width: 12 },
      { header: 'Hour price', key: 'hourPrice', width: 14 },
      { header: 'Gross', key: 'gross', width: 14 },
      { header: 'Deductions', key: 'deductions', width: 14 },
      { header: 'Net', key: 'net', width: 14 },
      { header: 'Currency', key: 'currency', width: 10 },
    ];
    ws.getRow(1).font = { bold: true };

    const MONEY_FMT = '#,##0.00';
    for (const r of rows) {
      const row = ws.addRow({
        // CSV/spreadsheet-formula-injection guard: a worker name is attacker-
        // influenceable text; if it begins with a formula trigger (= + - @, tab,
        // CR) prefix a single quote so the sheet treats it as a literal, never a
        // formula. Money cells are pushed as numbers (not affected).
        worker: sanitizeCell(r.workerName),
        period: periodLabel,
        hours: r.totalHours,
        // Mark fixed-monthly rows so the informational rate is not misread as rate×hours.
        hourPrice: r.hourlyWage,
        gross: r.gross,
        deductions: r.deductionsTotal,
        net: r.net,
        currency: r.currency,
      });
      row.getCell('hourPrice').numFmt = MONEY_FMT;
      row.getCell('gross').numFmt = MONEY_FMT;
      row.getCell('deductions').numFmt = MONEY_FMT;
      row.getCell('net').numFmt = MONEY_FMT;
      if (r.isMonthly) {
        // A note on the informational monthly rate (Excel can't carry a superscript
        // cheaply — a cell comment keeps the number clean while flagging the caveat).
        row.getCell('hourPrice').note =
          'Informational — monthly-salary worker (gross ≠ rate × hours)';
      }
    }

    // exceljs types xlsx.writeBuffer() as ArrayBuffer-ish; normalise to a Node Buffer.
    const out = await wb.xlsx.writeBuffer();
    return Buffer.from(out as ArrayBuffer);
  }
}
