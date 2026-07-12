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

  // ── Loans (FR-MGR-LOAN) ──────────────────────────────────────────────────

  async listLoans(query: ListQuery): Promise<Paginated<Loan>> {
    const where = query.workerId ? { workerId: query.workerId } : {};
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

  async createLoan(input: CreateLoan): Promise<Loan> {
    const row = await prisma.loan.create({
      data: {
        workerId: input.workerId,
        amount: input.amount,
        currency: input.currency,
        date: new Date(input.date),
        notes: input.notes ?? null,
        outstanding: input.outstanding ?? input.amount,
      },
    });
    return mapLoan(row);
  }

  async updateLoan(id: string, input: UpdateLoan): Promise<Loan> {
    await this.ensureLoan(id);
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

  async removeLoan(id: string): Promise<void> {
    await this.ensureLoan(id);
    await prisma.loan.delete({ where: { id } });
  }

  // ── Advances (FR-MGR-ADV) ────────────────────────────────────────────────

  async listAdvances(query: ListQuery): Promise<Paginated<AdvancePayment>> {
    const where = query.workerId ? { workerId: query.workerId } : {};
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

  async createAdvance(input: CreateAdvance): Promise<AdvancePayment> {
    const row = await prisma.advancePayment.create({
      data: {
        workerId: input.workerId,
        amount: input.amount,
        currency: input.currency,
        date: new Date(input.date),
        notes: input.notes ?? null,
        outstanding: input.outstanding ?? input.amount,
      },
    });
    return mapAdvance(row);
  }

  async updateAdvance(id: string, input: UpdateAdvance): Promise<AdvancePayment> {
    await this.ensureAdvance(id);
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

  async removeAdvance(id: string): Promise<void> {
    await this.ensureAdvance(id);
    await prisma.advancePayment.delete({ where: { id } });
  }

  // ── Profit & Loss (FR-MGR-PNL) ───────────────────────────────────────────

  /**
   * Compute a P&L snapshot on demand (not persisted). Revenue is the manual
   * per-site input from the query. Salary cost is computed via the salary engine
   * for every non-archived worker in scope; loans/advances cost = their outstanding
   * within the date window.
   */
  async profitLoss(query: PnlQuery): Promise<ProfitLoss> {
    const from = new Date(query.from);
    const to = new Date(query.to);

    // Workers in scope: those with attendance (optionally on the given site) in range.
    const attendance = await prisma.attendanceRecord.findMany({
      where: {
        date: { gte: from, lte: to },
        ...(query.siteId ? { siteId: query.siteId } : {}),
      },
      select: { workerId: true },
      distinct: ['workerId'],
    });
    const workerIds = attendance.map((a) => a.workerId);

    let salaryCost = 0;
    for (const workerId of workerIds) {
      try {
        const result = await this.salary.calculate({
          workerId,
          siteId: query.siteId,
          periodStart: query.from,
          periodEnd: query.to,
        });
        salaryCost += result.gross;
      } catch {
        // Skip workers without a configured wage — don't fail the whole P&L.
      }
    }

    const loanAgg = await prisma.loan.aggregate({
      _sum: { outstanding: true },
      where: {
        date: { gte: from, lte: to },
        ...(query.siteId
          ? { worker: { assignments: { some: { siteId: query.siteId } } } }
          : {}),
      },
    });
    const advanceAgg = await prisma.advancePayment.aggregate({
      _sum: { outstanding: true },
      where: {
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

  private async ensureLoan(id: string): Promise<void> {
    const exists = await prisma.loan.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw AppError.notFound('Loan not found');
  }

  private async ensureAdvance(id: string): Promise<void> {
    const exists = await prisma.advancePayment.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw AppError.notFound('Advance payment not found');
  }
}
