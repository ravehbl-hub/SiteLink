/**
 * SiteLink back end — salary service (FR-MGR-SRE / FR-MGR-PAY).
 *
 * Assembles the SalaryInput from persisted data and computes via the resolved
 * strategy. The MODE is resolved SERVER-SIDE from stored config
 * (ProfessionWageRate.calcMode for the worker's profession/site), never from the
 * request. The rate prefers the per-worker WorkerSalaryData, falling back to the
 * profession wage rate.
 */
import type { z } from 'zod';
import {
  toSalaryMode,
  type SalaryHoursByDay,
  type SalaryInput,
  type SalaryResult,
} from '@sitelink/shared';
import { AttendanceType, SalaryCalcMode } from '@sitelink/shared';
import { prisma } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { toDateOnly } from '../../lib/dates.js';
import { toNumber } from '../../lib/money.js';
import {
  assertCompanyScopeMatch,
  resolveCompanyScope,
  type CompanyScope,
} from '../../lib/scope.js';
import type { AuthUser } from '../../plugins/types.js';
import { SalaryEngineFactory } from './factory.js';
import { SALARY_WARNINGS } from './strategies.js';
import type { calculateSalarySchema } from './schemas.js';

type CalcInput = z.infer<typeof calculateSalarySchema>;

/** SalaryResult plus any engine warnings surfaced by the service. */
export interface SalaryCalculation extends SalaryResult {
  warnings: string[];
}

export class SalaryService {
  constructor(private readonly factory = new SalaryEngineFactory()) {}

  async calculate(input: CalcInput, caller?: AuthUser): Promise<SalaryCalculation> {
    const worker = await prisma.worker.findUnique({
      where: { id: input.workerId },
      include: { salaryData: true },
    });
    // MULTI-TENANCY (P2): a cross-company worker → 404 (no cross-tenant pay computed).
    const scope: CompanyScope = caller ? resolveCompanyScope(caller) : { allCompanies: true };
    assertCompanyScopeMatch(scope, worker?.companyId);
    if (!worker) throw AppError.notFound('Worker not found');

    // Resolve the wage rule for this worker's profession (+ optional site scope).
    // MULTI-TENANCY (P2, TOP FLAGGED LEAK): ProfessionWageRate is now PER-COMPANY
    // (@@unique[companyId,profession,siteId]). The wage lookup MUST filter by the
    // worker's OWN companyId so a worker NEVER resolves to another company's rate — a
    // company-wide rate is (companyId = worker's, siteId = null).
    const wageRate = await prisma.professionWageRate.findFirst({
      where: {
        companyId: worker.companyId,
        profession: worker.profession,
        OR: [{ siteId: input.siteId ?? null }, { siteId: null }],
      },
      // Prefer a site-specific rule over the global one.
      orderBy: { siteId: 'desc' },
    });

    // Rate: per-worker wage overrides profession default when present.
    const hourlyWage = worker.salaryData
      ? toNumber(worker.salaryData.hourlyWage)
      : wageRate
        ? toNumber(wageRate.wage)
        : 0;
    if (hourlyWage <= 0 && !worker.salaryData) {
      throw AppError.validation(
        'No wage configured for this worker (set WorkerSalaryData or a ProfessionWageRate)',
      );
    }
    const currency = worker.salaryData?.currency ?? wageRate?.currency ?? 'ILS';

    // Mode comes from STORED config (never the request). Default FIXED if unset.
    // Prisma's enum is a string union whose values match the shared enum byte-for-byte.
    const calcMode = (wageRate?.calcMode as SalaryCalcMode | undefined) ?? SalaryCalcMode.FIXED;
    const mode = toSalaryMode(calcMode);

    // Assemble hoursByDay from attendance in the period.
    const records = await prisma.attendanceRecord.findMany({
      where: {
        workerId: input.workerId,
        date: { gte: new Date(input.periodStart), lte: new Date(input.periodEnd) },
      },
      orderBy: { date: 'asc' },
    });
    const hoursByDay: SalaryHoursByDay[] = records.map((r) => ({
      date: toDateOnly(r.date),
      hours: r.type === AttendanceType.ATTENDANCE ? toNumber(r.hours) : 0,
      status:
        r.type === AttendanceType.ATTENDANCE
          ? 'attendance'
          : r.type === AttendanceType.VACATION
            ? 'vacation'
            : 'disease',
    }));

    const salaryInput: SalaryInput = {
      workerId: input.workerId,
      siteId: input.siteId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      mode,
      hoursByDay,
      hourlyWage,
      // For a FIXED monthly rule, pass the wage as the fixed salary.
      ...(mode === 'fixed' && wageRate?.rateType === 'MONTHLY'
        ? { fixedSalary: toNumber(wageRate.wage) }
        : {}),
      currency,
    };

    const engine = this.factory.resolve(mode);
    const result = engine.compute(salaryInput);

    const warnings: string[] = [];
    if (mode === 'israeli-labor-law') warnings.push(SALARY_WARNINGS.ISRAELI_STUB);

    return { ...result, warnings };
  }

  /**
   * BATCH salary computation for many workers over one period (perf: eliminates the
   * per-worker N+1 that the dashboard rollup + P&L incurred).
   *
   * Semantics are byte-for-byte identical to calling `calculate()` per worker:
   *   - same wage-rule resolution (per-worker WorkerSalaryData overrides the
   *     ProfessionWageRate; a site-specific rate beats the global one),
   *   - same mode resolution from stored config (FIXED default),
   *   - same "skip workers with no configured wage" behaviour (they're omitted from
   *     the result map, exactly as calculate() would have thrown-and-been-caught).
   * The ONLY difference is round-trips: 3 bulk queries total instead of 3×N. All
   * per-worker `compute()` work stays in-memory (pure), so results are unchanged.
   *
   * Returns a Map keyed by workerId → SalaryCalculation for every worker that HAS a
   * usable wage; workers with no wage are simply absent (callers sum over the map).
   */
  async calculateMany(
    workerIds: string[],
    period: { siteId?: string; periodStart: string; periodEnd: string },
    companyScope?: CompanyScope,
  ): Promise<Map<string, SalaryCalculation>> {
    const out = new Map<string, SalaryCalculation>();
    if (workerIds.length === 0) return out;
    const ids = [...new Set(workerIds)];

    // ── 3 bulk reads (was 3 PER worker) ─────────────────────────────────────
    // MULTI-TENANCY (P2, TOP FLAGGED LEAK): the worker set is HARD-filtered to the
    // caller's company when a scope is supplied, so a workerId from another company
    // can NEVER be computed here (it is simply absent from `workers`). ADMIN /
    // no-scope callers see all (the caller — dashboard/finance — already company-scoped
    // the id set upstream). Belt-and-suspenders: the wage lookup below is ALSO keyed on
    // each worker's OWN companyId, so no worker resolves another company's rate.
    const companyIdFilter =
      companyScope && 'companyId' in companyScope ? { companyId: companyScope.companyId } : {};
    const workers = await prisma.worker.findMany({
      where: { id: { in: ids }, ...companyIdFilter },
      include: { salaryData: true },
    });
    const professions = [...new Set(workers.map((w) => w.profession))];
    const companyIds = [...new Set(workers.map((w) => w.companyId))];
    // All candidate wage rules for the professions AND companies in play: the
    // site-specific rule for the given site AND the global (siteId=null) fallback,
    // batched across professions+companies. We match PER worker on (companyId,
    // profession, siteId) below, so a company-wide rate is (worker's companyId,
    // siteId=null) — never another company's rate.
    const wageRates = await prisma.professionWageRate.findMany({
      where: {
        companyId: { in: companyIds.length ? companyIds : ['__none__'] },
        profession: { in: professions },
        OR: [{ siteId: period.siteId ?? null }, { siteId: null }],
      },
    });
    const records = await prisma.attendanceRecord.findMany({
      where: {
        workerId: { in: ids },
        date: { gte: new Date(period.periodStart), lte: new Date(period.periodEnd) },
      },
      orderBy: { date: 'asc' },
    });

    // Index attendance by worker (rows already globally date-sorted → per-worker
    // slices stay ascending, matching the single-worker orderBy).
    const recordsByWorker = new Map<string, typeof records>();
    for (const r of records) {
      const list = recordsByWorker.get(r.workerId) ?? [];
      list.push(r);
      recordsByWorker.set(r.workerId, list);
    }

    for (const worker of workers) {
      // Resolve the wage rule exactly like calculate(): prefer a site-specific rule
      // (siteId === period.siteId) over the global one (siteId === null). P2: candidates
      // are restricted to the worker's OWN company — never another tenant's rate even
      // for the same profession.
      const candidates = wageRates.filter(
        (w) => w.profession === worker.profession && w.companyId === worker.companyId,
      );
      const wageRate =
        candidates.find((w) => w.siteId === (period.siteId ?? null)) ??
        candidates.find((w) => w.siteId === null) ??
        null;

      const hourlyWage = worker.salaryData
        ? toNumber(worker.salaryData.hourlyWage)
        : wageRate
          ? toNumber(wageRate.wage)
          : 0;
      // Same skip rule as calculate(): no wage configured → omit this worker.
      if (hourlyWage <= 0 && !worker.salaryData) continue;

      const currency = worker.salaryData?.currency ?? wageRate?.currency ?? 'ILS';
      const calcMode =
        (wageRate?.calcMode as SalaryCalcMode | undefined) ?? SalaryCalcMode.FIXED;
      const mode = toSalaryMode(calcMode);

      const hoursByDay: SalaryHoursByDay[] = (recordsByWorker.get(worker.id) ?? []).map(
        (r) => ({
          date: toDateOnly(r.date),
          hours: r.type === AttendanceType.ATTENDANCE ? toNumber(r.hours) : 0,
          status:
            r.type === AttendanceType.ATTENDANCE
              ? 'attendance'
              : r.type === AttendanceType.VACATION
                ? 'vacation'
                : 'disease',
        }),
      );

      const salaryInput: SalaryInput = {
        workerId: worker.id,
        siteId: period.siteId,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        mode,
        hoursByDay,
        hourlyWage,
        ...(mode === 'fixed' && wageRate?.rateType === 'MONTHLY'
          ? { fixedSalary: toNumber(wageRate.wage) }
          : {}),
        currency,
      };

      const engine = this.factory.resolve(mode);
      const result = engine.compute(salaryInput);
      const warnings: string[] = [];
      if (mode === 'israeli-labor-law') warnings.push(SALARY_WARNINGS.ISRAELI_STUB);
      out.set(worker.id, { ...result, warnings });
    }

    return out;
  }
}
