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
import type { SiteScope } from '../../lib/scope.js';
import { FinanceService } from '../finance/service.js';
import { SalaryService } from '../salary/service.js';
import type { DashboardQuery } from './schemas.js';

/**
 * Multi-site scope → a Prisma `siteId` filter fragment. `{ all: true }` (ADMIN/MANAGER,
 * all sites) → no constraint. A concrete `siteIds` set → `{ in: siteIds }` (one site
 * for a narrowed/single-site view, or the foreman's whole UNION). The scope is
 * SERVER-resolved (route → effectiveSiteScope), so an in-scope set can be trusted here.
 */
function siteIdFilter(scope: SiteScope): { in: string[] } | undefined {
  if ('all' in scope) return undefined;
  return { in: scope.siteIds };
}

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

  async rollup(query: DashboardQuery, scope: SiteScope): Promise<DashboardRollup> {
    const fallback = defaultWindow();
    const fromISO = query.from ?? fallback.from;
    const toISO = query.to ?? fallback.to;
    const from = new Date(fromISO);
    const to = new Date(toISO);
    // SECURITY: the effective site filter comes from the caller-resolved scope, NOT
    // the raw client siteId. `siteIn` = a set constraint (single site, foreman union,
    // or undefined = all sites for ADMIN/MANAGER). `filterSiteId` is what we ECHO back
    // in the response: the requested single site, else null (union/all-sites view).
    const siteIn = siteIdFilter(scope);
    const filterSiteId = 'all' in scope ? (query.siteId ?? null)
      : scope.siteIds.length === 1 ? scope.siteIds[0]
      : null;

    // ── WORKERS: active headcount in scope ────────────────────────────────
    const workerWhere = {
      isArchived: false,
      ...(siteIn ? { assignments: { some: { siteId: siteIn } } } : {}),
    };
    const amountOfWorkers = await prisma.worker.count({ where: workerWhere });

    // Workers-per-site breakdown (active workers only). For a scoped filter this is
    // the site(s) in scope; all-sites lists every active site.
    const siteWhere = siteIn ? { id: siteIn } : { isArchived: false };
    const sites = await prisma.site.findMany({
      where: siteWhere,
      select: { id: true, name: true },
    });
    const workersPerSite = await this.countWorkersPerSite(sites);

    // ── WORKERS: attendance/vacation/disease counts + total worked hours ──
    const attendance = await prisma.attendanceRecord.findMany({
      where: {
        date: { gte: from, lte: to },
        ...(siteIn ? { siteId: siteIn } : {}),
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
        ...(siteIn
          ? { worker: { assignments: { some: { siteId: siteIn } } } }
          : {}),
      },
    });
    const advanceAgg = await prisma.advancePayment.aggregate({
      _sum: { outstanding: true },
      where: {
        date: { gte: from, lte: to },
        ...(siteIn
          ? { worker: { assignments: { some: { siteId: siteIn } } } }
          : {}),
      },
    });
    const loansTotal = toNumber(loanAgg._sum.outstanding);
    const advancePaymentsTotal = toNumber(advanceAgg._sum.outstanding);

    // ── FINANCE: salary total via the SalaryRuleEngine ───────────────────
    // Worker set is scoped to the site(s) in scope (single site, foreman union, or
    // all). `filterSiteId` (single site or null) is passed to per-worker calc — for a
    // multi-site union the salary calc runs unfiltered by site over the scoped workers.
    const scopedWorkerIds = await this.workersWithActivity(from, to, siteIn);
    const salarySiteId = filterSiteId ?? undefined;
    // BATCH: one bulk calc for the whole scoped worker set (was an N+1 loop issuing
    // 3 queries per worker). Workers without a configured wage are simply absent from
    // the map — same skip semantics the old per-worker try/catch produced.
    const salaryByWorker = await this.salary.calculateMany(scopedWorkerIds, {
      siteId: salarySiteId,
      periodStart: fromISO,
      periodEnd: toISO,
    });
    let salaryTotal = 0;
    for (const result of salaryByWorker.values()) salaryTotal += result.gross;
    salaryTotal = round2(salaryTotal);

    // ── FINANCE: P&L (manual revenue, delegated to FinanceService) ───────
    const profitAndLoss = await this.finance.profitLoss({
      siteId: filterSiteId ?? undefined,
      from: fromISO,
      to: toISO,
      revenue: query.revenue,
      currency: query.currency,
    });

    return {
      filter: { siteId: filterSiteId, from: fromISO, to: toISO },
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

  /**
   * Worker-count report: active headcount per site (FR-FOR worker-count). The
   * caller-scope (effective site set) is resolved in the route: a FOREMAN only ever
   * passes their own site(s) here — a single narrowed site or their whole union;
   * ADMIN/MANAGER pass `{ all: true }` (every active site).
   */
  async workerCount(scope: SiteScope): Promise<WorkersPerSite[]> {
    const siteIn = siteIdFilter(scope);
    const siteWhere = siteIn ? { id: siteIn } : { isArchived: false };
    const sites = await prisma.site.findMany({
      where: siteWhere,
      select: { id: true, name: true },
    });
    return this.countWorkersPerSite(sites);
  }

  /**
   * Active-worker headcount per site for a set of sites, in ONE grouped query
   * (was an N+1 per-site `worker.count` loop). Counts SiteAssignment rows whose
   * worker is non-archived, grouped by siteId — identical to the old
   * `assignments: { some: { siteId } }` count (no unassignedAt filter, to preserve
   * byte-for-byte the previous result). Sites with no active workers report 0.
   */
  private async countWorkersPerSite(
    sites: { id: string; name: string }[],
  ): Promise<WorkersPerSite[]> {
    if (sites.length === 0) return [];
    const siteIds = sites.map((s) => s.id);
    const grouped = await prisma.siteAssignment.groupBy({
      by: ['siteId'],
      where: { siteId: { in: siteIds }, worker: { isArchived: false } },
      _count: { workerId: true },
    });
    const countBySite = new Map(grouped.map((g) => [g.siteId, g._count.workerId]));
    return sites.map((s) => ({
      siteId: s.id,
      siteName: s.name,
      workerCount: countBySite.get(s.id) ?? 0,
    }));
  }

  /** Distinct worker ids with attendance in the window (optionally site-scoped). */
  private async workersWithActivity(
    from: Date,
    to: Date,
    siteIn?: { in: string[] },
  ): Promise<string[]> {
    const rows = await prisma.attendanceRecord.findMany({
      where: {
        date: { gte: from, lte: to },
        ...(siteIn ? { siteId: siteIn } : {}),
      },
      select: { workerId: true },
      distinct: ['workerId'],
    });
    return rows.map((r) => r.workerId);
  }
}
