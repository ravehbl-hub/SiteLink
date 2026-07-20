/**
 * SiteLink back end — finance service (FR-MGR-LOAN / FR-MGR-ADV / FR-MGR-PNL).
 *
 * Loans + advance payments per worker; Profit & Loss read scoped by site + date.
 * Per PRD A-3 assumption, revenue is a MANUAL per-site input passed on the P&L
 * query; costs derive from salary (via the salary engine), loans and advances in
 * scope.
 */
import type { z } from 'zod';
import type {
  AdvancePayment,
  Loan,
  Paginated,
  ProfitLoss,
} from '@sitelink/shared';
import { prisma } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { mapAdvance, mapLoan } from '../../lib/mappers.js';
import { round2, toNumber } from '../../lib/money.js';
import { paginate } from '../../lib/pagination.js';
import { toISORequired } from '../../lib/dates.js';
import {
  assertCompanyScopeMatch,
  companyWhere,
  effectiveCompanyScope,
  resolveCompanyScope,
  resolveStampCompanyId,
  type CompanyScope,
} from '../../lib/scope.js';
import { Role } from '@sitelink/shared';
import type { AuthUser } from '../../plugins/types.js';
import { SalaryService } from '../salary/service.js';
import type {
  createAdvanceSchema,
  createLoanSchema,
  listByWorkerQuery,
  profitLossQuery,
  updateAdvanceSchema,
  updateLoanSchema,
} from './schemas.js';

type CreateLoan = z.infer<typeof createLoanSchema>;
type UpdateLoan = z.infer<typeof updateLoanSchema>;
type CreateAdvance = z.infer<typeof createAdvanceSchema>;
type UpdateAdvance = z.infer<typeof updateAdvanceSchema>;
type ListQuery = z.infer<typeof listByWorkerQuery>;
type PnlQuery = z.infer<typeof profitLossQuery>;

export class FinanceService {
  constructor(private readonly salary = new SalaryService()) {}

  private companyScope(caller?: AuthUser): CompanyScope {
    return caller ? resolveCompanyScope(caller) : { allCompanies: true };
  }

  /**
   * P2: stamp a ledger row (Loan/Advance) with the WORKER's company (server-derived,
   * never the client) and assert the worker is in the caller's company (404 else).
   * Loan/AdvancePayment carry a DIRECT companyId (= worker's).
   */
  private async companyForWorker(workerId: string, caller?: AuthUser): Promise<string> {
    const worker = await prisma.worker.findUnique({
      where: { id: workerId },
      select: { companyId: true },
    });
    assertCompanyScopeMatch(this.companyScope(caller), worker?.companyId);
    if (!worker) throw AppError.notFound('Worker not found');
    return worker.companyId;
  }

  // ── Loans (FR-MGR-LOAN) ──────────────────────────────────────────────────

  async listLoans(query: ListQuery, caller?: AuthUser): Promise<Paginated<Loan>> {
    const companyClause = caller
      ? companyWhere(effectiveCompanyScope(caller, query.companyId))
      : {};
    const where = { ...companyClause, ...(query.workerId ? { workerId: query.workerId } : {}) };
    const skip = (query.page - 1) * query.pageSize;
    const [rows, total] = await Promise.all([
      prisma.loan.findMany({ where, skip, take: query.pageSize, orderBy: { date: 'desc' } }),
      prisma.loan.count({ where }),
    ]);
    return paginate(rows.map(mapLoan), total, {
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  async createLoan(input: CreateLoan, caller?: AuthUser): Promise<Loan> {
    const companyId = await this.companyForWorker(input.workerId, caller);
    const row = await prisma.loan.create({
      data: {
        workerId: input.workerId,
        companyId,
        amount: input.amount,
        currency: input.currency,
        date: new Date(input.date),
        notes: input.notes ?? null,
        outstanding: input.outstanding ?? input.amount,
      },
    });
    return mapLoan(row);
  }

  async updateLoan(id: string, input: UpdateLoan, caller?: AuthUser): Promise<Loan> {
    await this.ensureLoan(id, caller);
    const row = await prisma.loan.update({
      where: { id },
      data: {
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.date !== undefined ? { date: new Date(input.date) } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.outstanding !== undefined ? { outstanding: input.outstanding } : {}),
      },
    });
    return mapLoan(row);
  }

  async removeLoan(id: string, caller?: AuthUser): Promise<void> {
    await this.ensureLoan(id, caller);
    await prisma.loan.delete({ where: { id } });
  }

  // ── Advances (FR-MGR-ADV) ────────────────────────────────────────────────

  async listAdvances(query: ListQuery, caller?: AuthUser): Promise<Paginated<AdvancePayment>> {
    const companyClause = caller
      ? companyWhere(effectiveCompanyScope(caller, query.companyId))
      : {};
    const where = { ...companyClause, ...(query.workerId ? { workerId: query.workerId } : {}) };
    const skip = (query.page - 1) * query.pageSize;
    const [rows, total] = await Promise.all([
      prisma.advancePayment.findMany({
        where,
        skip,
        take: query.pageSize,
        orderBy: { date: 'desc' },
      }),
      prisma.advancePayment.count({ where }),
    ]);
    return paginate(rows.map(mapAdvance), total, {
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  async createAdvance(input: CreateAdvance, caller?: AuthUser): Promise<AdvancePayment> {
    const companyId = await this.companyForWorker(input.workerId, caller);
    const row = await prisma.advancePayment.create({
      data: {
        workerId: input.workerId,
        companyId,
        amount: input.amount,
        currency: input.currency,
        date: new Date(input.date),
        notes: input.notes ?? null,
        outstanding: input.outstanding ?? input.amount,
      },
    });
    return mapAdvance(row);
  }

  async updateAdvance(id: string, input: UpdateAdvance, caller?: AuthUser): Promise<AdvancePayment> {
    await this.ensureAdvance(id, caller);
    const row = await prisma.advancePayment.update({
      where: { id },
      data: {
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.date !== undefined ? { date: new Date(input.date) } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.outstanding !== undefined ? { outstanding: input.outstanding } : {}),
      },
    });
    return mapAdvance(row);
  }

  async removeAdvance(id: string, caller?: AuthUser): Promise<void> {
    await this.ensureAdvance(id, caller);
    await prisma.advancePayment.delete({ where: { id } });
  }

  // ── Profit & Loss (FR-MGR-PNL) ───────────────────────────────────────────

  /**
   * Compute a P&L snapshot on demand (not persisted). Revenue is the manual
   * per-site input from the query. Salary cost is computed via the salary engine
   * for every non-archived worker in scope; loans/advances cost = their outstanding
   * within the date window.
   */
  async profitLoss(query: PnlQuery, companyScope?: CompanyScope): Promise<ProfitLoss> {
    const from = new Date(query.from);
    const to = new Date(query.to);

    // MULTI-TENANCY (P2, TOP FLAGGED LEAK): every underlying aggregate is company-scoped
    // so a P&L NEVER silently sums across tenants. AttendanceRecord/Loan/AdvancePayment
    // all carry a DIRECT companyId; the salary batch is scoped via `companyScope`.
    const companyClause = companyScope ? companyWhere(companyScope) : {};

    // Workers in scope: those with attendance (optionally on the given site) in range.
    const attendance = await prisma.attendanceRecord.findMany({
      where: {
        ...companyClause,
        date: { gte: from, lte: to },
        ...(query.siteId ? { siteId: query.siteId } : {}),
      },
      select: { workerId: true },
      distinct: ['workerId'],
    });
    const workerIds = attendance.map((a) => a.workerId);

    // BATCH: one bulk salary calc for the in-scope worker set (was an N+1 loop of
    // 3 queries per worker). Company-scoped so a cross-tenant worker can never be
    // summed; workers without a configured wage are absent from the map.
    const salaryByWorker = await this.salary.calculateMany(
      workerIds,
      {
        siteId: query.siteId,
        periodStart: query.from,
        periodEnd: query.to,
      },
      companyScope,
    );
    let salaryCost = 0;
    for (const result of salaryByWorker.values()) salaryCost += result.gross;

    const loanAgg = await prisma.loan.aggregate({
      _sum: { outstanding: true },
      where: {
        ...companyClause,
        date: { gte: from, lte: to },
        ...(query.siteId
          ? { worker: { assignments: { some: { siteId: query.siteId } } } }
          : {}),
      },
    });
    const advanceAgg = await prisma.advancePayment.aggregate({
      _sum: { outstanding: true },
      where: {
        ...companyClause,
        date: { gte: from, lte: to },
        ...(query.siteId
          ? { worker: { assignments: { some: { siteId: query.siteId } } } }
          : {}),
      },
    });

    const loansCost = toNumber(loanAgg._sum.outstanding);
    const advancesCost = toNumber(advanceAgg._sum.outstanding);
    const salaryRounded = round2(salaryCost);
    const netProfit = round2(query.revenue - (salaryRounded + loansCost + advancesCost));
    const now = toISORequired(new Date());

    return {
      id: 'computed',
      siteId: query.siteId ?? null,
      periodStart: query.from,
      periodEnd: query.to,
      currency: query.currency,
      revenue: round2(query.revenue),
      salaryCost: salaryRounded,
      loansCost,
      advancesCost,
      otherCost: 0,
      netProfit,
      createdAt: now,
      updatedAt: now,
    };
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async ensureLoan(id: string, caller?: AuthUser): Promise<void> {
    const row = await prisma.loan.findUnique({
      where: { id },
      select: { id: true, companyId: true },
    });
    // P2: cross-company loan → 404 (no existence leak) before any mutation.
    assertCompanyScopeMatch(this.companyScope(caller), row?.companyId);
    if (!row) throw AppError.notFound('Loan not found');
  }

  private async ensureAdvance(id: string, caller?: AuthUser): Promise<void> {
    const row = await prisma.advancePayment.findUnique({
      where: { id },
      select: { id: true, companyId: true },
    });
    assertCompanyScopeMatch(this.companyScope(caller), row?.companyId);
    if (!row) throw AppError.notFound('Advance payment not found');
  }
}
