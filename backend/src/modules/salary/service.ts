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
import {
  AttendanceType,
  RequestStatus,
  RequestType,
  SalaryCalcMode,
} from '@sitelink/shared';
import { prisma } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { toDateOnly } from '../../lib/dates.js';
import { toNumber, round2 } from '../../lib/money.js';
import {
  assertCompanyScopeMatch,
  resolveCompanyScope,
  type CompanyScope,
} from '../../lib/scope.js';
import type { AuthUser } from '../../plugins/types.js';
import { SalaryEngineFactory } from './factory.js';
import { SALARY_WARNINGS, attendanceHours } from './strategies.js';
import type { calculateSalarySchema } from './schemas.js';

// INPUT type (defaults optional): both the route (passing the parsed OUTPUT) and
// the reports service (passing a bare period object without split params) satisfy
// this. Inside calculate() the split defaults are applied explicitly.
type CalcInput = z.input<typeof calculateSalarySchema>;

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
    let result = engine.compute(salaryInput);

    // HOURS-SPLIT PAYMENT (optional, request-driven, default OFF). When enabled,
    // the worker's total ATTENDANCE hours are split at `splitThreshold`:
    //   Personnel  = min(totalHours, threshold) × personnel (resolved) rate,
    //   Contractor = max(0, totalHours − threshold) × contractorRate (request).
    // GROSS becomes the combined split total (personnel + contractor) and the
    // breakdown is replaced by the two split lines. When OFF, `result` is the
    // UNCHANGED engine output. `contractorRate` is validated required-when-enabled
    // at the schema layer, so it is a number here whenever splitEnabled is true.
    if (input.splitEnabled) {
      const threshold = input.splitThreshold ?? 236;
      const contractorRate = input.contractorRate ?? 0;
      const totalHours = attendanceHours(salaryInput);
      const personnelHours = Math.min(totalHours, threshold);
      const contractorHours = Math.max(0, totalHours - threshold);
      const personnelAmount = round2(personnelHours * hourlyWage);
      const contractorAmount = round2(contractorHours * contractorRate);
      const gross = round2(personnelAmount + contractorAmount);

      result = {
        ...result,
        gross,
        breakdown: [
          { label: `Personnel (${personnelHours}h × ${hourlyWage})`, amount: personnelAmount },
          { label: `Contractor (${contractorHours}h × ${contractorRate})`, amount: contractorAmount },
        ],
        split: {
          enabled: true,
          threshold,
          personnelHours,
          personnelRate: hourlyWage,
          personnelAmount,
          contractorHours,
          contractorRate,
          contractorAmount,
        },
      };
    }

    // NET WAGE (נטו): reconcile GROSS against the worker's OWN-company APPROVED
    // loan/advance requests that fall within THIS period. See computeDeductions.
    const { loansTotal, advancesTotal, net } = await this.computeDeductions({
      workerId: input.workerId,
      companyId: worker.companyId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      gross: result.gross,
    });

    const warnings: string[] = [];
    if (mode === 'israeli-labor-law') warnings.push(SALARY_WARNINGS.ISRAELI_STUB);

    return { ...result, loansTotal, advancesTotal, net, warnings };
  }

  /**
   * NET WAGE (נטו) deductions for ONE worker over ONE period.
   *
   * NET = gross − Σ(approved LOAN) − Σ(approved ADVANCE), where the summed requests
   * are, ALL of the following (defense-in-depth):
   *   - status === APPROVED     (never PENDING / REJECTED),
   *   - type   === LOAN | ADVANCE,
   *   - companyId === the WORKER's own company (P2 — a deduction must NEVER pull
   *     another tenant's request even for the same workerId; belt-and-suspenders
   *     alongside the workerId key),
   *   - PERIOD-SCOPED (DEFAULT, IMPLEMENTED HERE): the request's `startDate`
   *     (the semantic money date — the same field the approval copies onto the
   *     Loan/AdvancePayment ledger row) falls within periodStart..periodEnd, so the
   *     deductions reconcile with the shown period.
   *
   *     FLAG (period-based vs all-outstanding): to instead deduct ALL outstanding
   *     approved loans/advances regardless of period, DROP the `startDate: {…}`
   *     line from the `where` below (one-line change).
   *
   * NET IS NOT FLOORED — it is returned as the REAL number and CAN be negative when
   * approved loans/advances exceed gross.
   */
  private async computeDeductions(args: {
    workerId: string;
    companyId: string;
    periodStart: string;
    periodEnd: string;
    gross: number;
  }): Promise<{ loansTotal: number; advancesTotal: number; net: number }> {
    const requests = await prisma.workerRequest.findMany({
      where: {
        workerId: args.workerId,
        // P2: OWN-company only — a deduction never crosses tenants (defense-in-depth).
        companyId: args.companyId,
        status: RequestStatus.APPROVED,
        type: { in: [RequestType.LOAN, RequestType.ADVANCE] },
        // PERIOD-SCOPED (default). Remove this one line for ALL-outstanding semantics.
        startDate: {
          gte: new Date(args.periodStart),
          lte: new Date(args.periodEnd),
        },
      },
      select: { type: true, amount: true },
    });

    let loansTotal = 0;
    let advancesTotal = 0;
    for (const r of requests) {
      const amount = r.amount ? toNumber(r.amount) : 0;
      if (r.type === RequestType.LOAN) loansTotal += amount;
      else if (r.type === RequestType.ADVANCE) advancesTotal += amount;
    }

    // REAL net — NOT floored at 0 (can be negative on purpose).
    const net = args.gross - loansTotal - advancesTotal;
    return { loansTotal, advancesTotal, net };
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
