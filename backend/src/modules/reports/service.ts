/**
 * SiteLink back end — reports service (FR-X-PDF). Renders templates to a PDF buffer.
 */
import { renderToBuffer } from '@react-pdf/renderer';
import { prisma } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { toDateOnly } from '../../lib/dates.js';
import { toNumber } from '../../lib/money.js';
import { AttendanceType } from '@sitelink/shared';
import { SalaryService } from '../salary/service.js';
import { FinanceService } from '../finance/service.js';
import {
  AttendanceSummaryDocument,
  PayslipDocument,
  ProfitLossDocument,
  type AttendanceSummaryRow,
  type ReportHeaderMeta,
} from './templates.js';

export class ReportsService {
  constructor(
    private readonly salary = new SalaryService(),
    private readonly finance = new FinanceService(),
  ) {}

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

    const meta: ReportHeaderMeta = {
      title: 'Payslip',
      from: toDateOnly(new Date(params.from)),
      to: toDateOnly(new Date(params.to)),
      direction: params.direction,
    };

    const doc = PayslipDocument({
      meta,
      workerName: `${worker.firstName} ${worker.lastName}`,
      result,
      warnings: result.warnings,
    });
    return renderToBuffer(doc);
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

    const doc = AttendanceSummaryDocument({ meta, rows: [...byWorker.values()] });
    return renderToBuffer(doc);
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

    const doc = ProfitLossDocument({ meta, pnl });
    return renderToBuffer(doc);
  }
}
