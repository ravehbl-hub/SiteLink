/**
 * SiteLink back end — dashboard rollup service (FR-MGR-DASH).
 *
 * Produces ONE server-computed rollup for a site/date filter, reusing existing
 * domain logic rather than re-implementing it:
 *   - Salary total is summed via the SalaryRuleEngine (SalaryService) across workers
 *     in scope — consistent with /salary/calculate and the P&L path.
 *   - P&L is delegated to FinanceService.profitLoss (revenue = MANUAL per-site input
 *     per PRD A-3; costs from salary/loans/advances). No persisted revenue model.
 *   - Working hours + attendance counts reuse the same attendance aggregation shape.
 *
 * All-sites view when siteId is omitted (FR-MGR-DASH-1). Empty scope → zeros, never
 * an error (FR-MGR-DASH-6).
 */
import type { DashboardRollup, WorkersPerSite } from '@sitelink/shared';
import { AttendanceType } from '@sitelink/shared';
import { prisma } from '../../db/client.js';
import { toISORequired } from '../../lib/dates.js';
import { round2, toNumber } from '../../lib/money.js';
import { FinanceService } from '../finance/service.js';
import { SalaryService } from '../salary/service.js';
import type { DashboardQuery } from './schemas.js';

/** Default window: first day of the current month → now (FR-MGR-DASH default). */
function defaultWindow(): { from: string; to: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { from: start.toISOString(), to: now.toISOString() };
}

export class DashboardService {
  constructor(
    private readonly salary = new SalaryService(),
    private readonly finance = new FinanceService(),
  ) {}

  async rollup(query: DashboardQuery): Promise<DashboardRollup> {
    const fallback = defaultWindow();
    const fromISO = query.from ?? fallback.from;
    const toISO = query.to ?? fallback.to;
    const from = new Date(fromISO);
    const to = new Date(toISO);
    const siteId = query.siteId;

    // ── WORKERS: active headcount in scope ────────────────────────────────
    const workerWhere = {
      isArchived: false,
      ...(siteId ? { assignments: { some: { siteId } } } : {}),
    };
    const amountOfWorkers = await prisma.worker.count({ where: workerWhere });

    // Workers-per-site breakdown (active workers only). For a single-site filter
    // this is just that site; all-sites lists every active site.
    const siteWhere = siteId ? { id: siteId } : { isArchived: false };
    const sites = await prisma.site.findMany({
      where: siteWhere,
      select: { id: true, name: true },
    });
    const workersPerSite: WorkersPerSite[] = [];
    for (const s of sites) {
      const count = await prisma.worker.count({
        where: { isArchived: false, assignments: { some: { siteId: s.id } } },
      });
      workersPerSite.push({ siteId: s.id, siteName: s.name, workerCount: count });
    }

    // ── WORKERS: attendance/vacation/disease counts + total worked hours ──
    const attendance = await prisma.attendanceRecord.findMany({
      where: {
        date: { gte: from, lte: to },
        ...(siteId ? { siteId } : {}),
      },
      select: { type: true, hours: true },
    });
    let attendanceDays = 0;
    let vacationDays = 0;
    let diseaseDays = 0;
    let totalWorkHours = 0;
    for (const r of attendance) {
      if (r.type === AttendanceType.ATTENDANCE) {
        attendanceDays += 1;
        totalWorkHours += toNumber(r.hours);
      } else if (r.type === AttendanceType.VACATION) {
        vacationDays += 1;
      } else {
        diseaseDays += 1;
      }
    }

    // ── WORKERS: loans + advances totals (outstanding, in scope) ─────────
    const loanAgg = await prisma.loan.aggregate({
      _sum: { outstanding: true },
      where: {
        date: { gte: from, lte: to },
        ...(siteId
          ? { worker: { assignments: { some: { siteId } } } }
          : {}),
      },
    });
    const advanceAgg = await prisma.advancePayment.aggregate({
      _sum: { outstanding: true },
      where: {
        date: { gte: from, lte: to },
        ...(siteId
          ? { worker: { assignments: { some: { siteId } } } }
          : {}),
      },
    });
    const loansTotal = toNumber(loanAgg._sum.outstanding);
    const advancePaymentsTotal = toNumber(advanceAgg._sum.outstanding);

    // ── FINANCE: salary total via the SalaryRuleEngine ───────────────────
    const scopedWorkerIds = await this.workersWithActivity(from, to, siteId);
    let salaryTotal = 0;
    for (const workerId of scopedWorkerIds) {
      try {
        const result = await this.salary.calculate({
          workerId,
          siteId,
          periodStart: fromISO,
          periodEnd: toISO,
        });
        salaryTotal += result.gross;
      } catch {
        // Workers without a configured wage are skipped (don't fail the rollup).
      }
    }
    salaryTotal = round2(salaryTotal);

    // ── FINANCE: P&L (manual revenue, delegated to FinanceService) ───────
    const profitAndLoss = await this.finance.profitLoss({
      siteId,
      from: fromISO,
      to: toISO,
      revenue: query.revenue,
      currency: query.currency,
    });

    return {
      filter: { siteId: siteId ?? null, from: fromISO, to: toISO },
      workers: {
        amountOfWorkers,
        attendanceDays,
        vacationDays,
        diseaseDays,
        totalWorkHours: round2(totalWorkHours),
        workersPerSite,
        loansTotal,
        advancePaymentsTotal,
      },
      finance: {
        currency: query.currency,
        salaryTotal,
        profitAndLoss,
      },
      computedAt: toISORequired(new Date()),
    };
  }

  /** Distinct worker ids with attendance in the window (optionally site-scoped). */
  private async workersWithActivity(
    from: Date,
    to: Date,
    siteId?: string,
  ): Promise<string[]> {
    const rows = await prisma.attendanceRecord.findMany({
      where: {
        date: { gte: from, lte: to },
        ...(siteId ? { siteId } : {}),
      },
      select: { workerId: true },
      distinct: ['workerId'],
    });
    return rows.map((r) => r.workerId);
  }
}
