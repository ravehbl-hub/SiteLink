/**
 * SiteLink back end — requests service (FR-REQ — modeled, Manager-gated).
 * Create + approve/reject. The Worker-initiated flow is v2; here the Manager can
 * model and resolve requests.
 */
import type { z } from 'zod';
import type { Paginated, WorkerRequest } from '@sitelink/shared';
import { AttendanceType, RequestStatus, RequestType } from '@sitelink/shared';
import type {
  Prisma,
  WorkerRequest as PWorkerRequest,
} from '../../generated/prisma/client.js';
import { prisma } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { mapRequest } from '../../lib/mappers.js';
import { paginate } from '../../lib/pagination.js';
import type {
  createRequestSchema,
  listRequestsQuery,
  resolveRequestSchema,
} from './schemas.js';

type CreateInput = z.infer<typeof createRequestSchema>;
type ResolveInput = z.infer<typeof resolveRequestSchema>;
type ListQuery = z.infer<typeof listRequestsQuery>;

export class RequestsService {
  async list(query: ListQuery): Promise<Paginated<WorkerRequest>> {
    const where = {
      ...(query.workerId ? { workerId: query.workerId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const skip = (query.page - 1) * query.pageSize;
    const [rows, total] = await Promise.all([
      prisma.workerRequest.findMany({
        where,
        skip,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.workerRequest.count({ where }),
    ]);
    return paginate(rows.map(mapRequest), total, {
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  /**
   * Create a PENDING request. `requestedById` is the user who submitted it (server-
   * derived at the route — the acting Manager, or in a future Worker-self flow the
   * Worker's own user). Status is always PENDING; it is only advanced via resolve().
   */
  async create(input: CreateInput, requestedById?: string): Promise<WorkerRequest> {
    const row = await prisma.workerRequest.create({
      data: {
        workerId: input.workerId,
        requestedById: requestedById ?? null,
        type: input.type,
        amount: input.amount ?? null,
        currency: input.currency ?? null,
        startDate: input.startDate ? new Date(input.startDate) : null,
        endDate: input.endDate ? new Date(input.endDate) : null,
        notes: input.notes ?? null,
      },
    });
    return mapRequest(row);
  }

  /**
   * Approve or reject a PENDING request (ADMIN/MANAGER only — gated at the route).
   * Runs in a single transaction so the status change and its SIDE EFFECT are atomic:
   *   - APPROVED VACATION → one AttendanceRecord (type VACATION) per day in
   *     [startDate, endDate] (or a single day when only startDate is set). Days that
   *     already have a record for the worker are skipped (the @@unique(worker,date)
   *     guard is respected — we never clobber an existing attendance/attendance day).
   *   - APPROVED LOAN     → a Loan row (amount, outstanding = amount).
   *   - APPROVED ADVANCE  → an AdvancePayment row (amount, outstanding = amount).
   *   - REJECTED          → status/resolution only, no side effect.
   * `resolvedById` is the acting Admin/Manager user (server-derived at the route).
   */
  async resolve(
    id: string,
    input: ResolveInput,
    resolvedById: string,
  ): Promise<WorkerRequest> {
    const current = await prisma.workerRequest.findUnique({ where: { id } });
    if (!current) throw AppError.notFound('Request not found');
    if (current.status !== RequestStatus.PENDING) {
      throw AppError.conflict('Request has already been resolved');
    }

    const row = await prisma.$transaction(async (tx) => {
      const updated = await tx.workerRequest.update({
        where: { id },
        data: {
          status: input.status,
          resolvedById,
          resolvedAt: new Date(),
          resolutionNotes: input.resolutionNotes ?? null,
        },
      });

      if (input.status === RequestStatus.APPROVED) {
        await this.applyApprovalEffect(tx, current);
      }
      return updated;
    });

    return mapRequest(row);
  }

  /**
   * Materialize the domain effect of an approved request. `req` is the ORIGINAL row
   * (pre-update) carrying type/amount/dates. Runs inside the resolve transaction.
   */
  private async applyApprovalEffect(
    tx: Prisma.TransactionClient,
    req: PWorkerRequest,
  ): Promise<void> {
    // Prisma's enum values match @sitelink/shared byte-for-byte; compare via the
    // shared enum's string values to bridge the nominal type gap.
    if (req.type === RequestType.VACATION) {
      if (!req.startDate) {
        throw AppError.validation('VACATION request missing startDate; cannot approve');
      }
      const end = req.endDate ?? req.startDate;
      if (end < req.startDate) {
        throw AppError.validation('VACATION endDate is before startDate');
      }
      // Iterate calendar days inclusive; create VACATION days, skip existing ones.
      for (
        let d = new Date(req.startDate);
        d <= end;
        d = new Date(d.getTime() + 24 * 60 * 60 * 1000)
      ) {
        const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
        const exists = await tx.attendanceRecord.findUnique({
          where: { workerId_date: { workerId: req.workerId, date: day } },
          select: { id: true },
        });
        if (exists) continue; // respect the one-record-per-worker/day guard
        await tx.attendanceRecord.create({
          data: {
            workerId: req.workerId,
            date: day,
            type: AttendanceType.VACATION,
            notes: req.notes ?? 'Approved vacation request',
          },
        });
      }
      return;
    }

    if (req.type === RequestType.LOAN || req.type === RequestType.ADVANCE) {
      if (req.amount === null) {
        throw AppError.validation(`${req.type} request missing amount; cannot approve`);
      }
      const data = {
        workerId: req.workerId,
        amount: req.amount,
        currency: req.currency ?? 'ILS',
        date: req.startDate ?? new Date(),
        notes: req.notes ?? `Approved ${req.type.toLowerCase()} request`,
        outstanding: req.amount,
      };
      if (req.type === RequestType.LOAN) {
        await tx.loan.create({ data });
      } else {
        await tx.advancePayment.create({ data });
      }
    }
  }
}
