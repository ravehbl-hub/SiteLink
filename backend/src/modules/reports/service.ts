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
import { loadConfig } from '../../config.js';
import { CloudConvertService } from '../../lib/cloudconvert.js';
import { AttendanceType } from '@sitelink/shared';
import type { WorkingHoursGrain } from '@sitelink/shared';
import { SalaryService } from '../salary/service.js';
import { FinanceService } from '../finance/service.js';
import { AttendanceService } from '../attendance/service.js';
import {
  AttendanceSummaryDocument,
  PayslipDocument,
  ProfitLossDocument,
  WorkingHoursDocument,
  type AttendanceSummaryRow,
  type ReportHeaderMeta,
} from './templates.js';
import {
  attendanceSummaryHtml,
  payslipHtml,
  profitLossHtml,
  workingHoursHtml,
} from './html-templates.js';

export class ReportsService {
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

  async payslipPdf(params: {
    workerId: string;
    siteId?: string;
    from: string;
    to: string;
    direction: 'ltr' | 'rtl';
  }): Promise<Buffer> {
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
    };

    const workerName = `${worker.firstName} ${worker.lastName}`;
    const data = {
      meta,
      workerName,
      result,
      warnings: result.warnings,
      hours,
      hourlyWage: result.hourlyWage,
    };
    return this.renderPdf(
      () => payslipHtml(data),
      () => PayslipDocument(data),
      'payslip',
    );
  }

  async workingHoursPdf(params: {
    workerId: string;
    siteId?: string;
    from: string;
    to: string;
    grain: WorkingHoursGrain;
    direction: 'ltr' | 'rtl';
  }): Promise<Buffer> {
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

  async attendanceSummaryPdf(params: {
    siteId?: string;
    from: string;
    to: string;
    direction: 'ltr' | 'rtl';
  }): Promise<Buffer> {
    const from = new Date(params.from);
    const to = new Date(params.to);

    const records = await prisma.attendanceRecord.findMany({
      where: {
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

  async profitLossPdf(params: {
    siteId?: string;
    from: string;
    to: string;
    revenue: number;
    currency: string;
    direction: 'ltr' | 'rtl';
  }): Promise<Buffer> {
    // Reuse the existing on-demand P&L computation — do not duplicate it here.
    const pnl = await this.finance.profitLoss({
      siteId: params.siteId,
      from: params.from,
      to: params.to,
      revenue: params.revenue,
      currency: params.currency,
    });

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
}
