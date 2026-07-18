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
  redecideRequestSchema,
  resolveRequestSchema,
} from './schemas.js';

type CreateInput = z.infer<typeof createRequestSchema>;
type ResolveInput = z.infer<typeof resolveRequestSchema>;
type RedecideInput = z.infer<typeof redecideRequestSchema>;
type ListQuery = z.infer<typeof listRequestsQuery>;

export class RequestsService {
  /**
   * List requests. When `forcedWorkerId` is provided (a WORKER self-scoping) the
   * result is HARD-filtered to that worker id, ignoring any client ?workerId — a
   * WORKER can only ever see their OWN requests.
   */
  async list(query: ListQuery, forcedWorkerId?: string): Promise<Paginated<WorkerRequest>> {
    const where = {
      ...(forcedWorkerId
        ? { workerId: forcedWorkerId }
        : query.workerId
          ? { workerId: query.workerId }
          : {}),
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
  async create(
    input: CreateInput,
    requestedById?: string,
    forcedWorkerId?: string,
  ): Promise<WorkerRequest> {
    // WORKER self-submit forces workerId to the caller's own; the manager path uses
    // the explicit body workerId (validated present at the route).
    const workerId = forcedWorkerId ?? input.workerId;
    if (!workerId) throw AppError.validation('workerId is required');
    const row = await prisma.workerRequest.create({
      data: {
        workerId,
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
   * RE-DECIDE an ALREADY-RESOLVED request (ADMIN/MANAGER only — gated at the route),
   * flipping it to the other terminal status and REVERSING/RE-APPLYING the side effect
   * atomically. This is the RESOLVED→other-status path; the PENDING path stays on
   * resolve() (the existing approve/reject endpoints).
   *
   * FINANCIAL-INTEGRITY invariants (all enforced here, server-side):
   *   - Effect target (worker/amount/dates) comes ONLY from the ORIGINAL request row —
   *     NEVER from the redecide body (body carries status + notes only).
   *   - `resolvedById` is ALWAYS the authenticated caller (server-derived), re-stamped
   *     on every re-decide — never accepted from the body.
   *   - Reversal deletes ONLY rows tagged `requestId = :id` — a manually-created
   *     Loan/Advance/Attendance of the same worker/amount/day (requestId null) is
   *     UNTOUCHED. No amount/worker/date matching is ever used to select rows to delete.
   *   - APPROVED→REJECTED reverses; REJECTED→APPROVED re-applies (fresh TAGGED rows);
   *     same-status is a 409 (no double side effect). A flip approve→reject→approve
   *     therefore yields EXACTLY ONE fresh tagged Loan, never two.
   *   - PARTIAL-REPAYMENT SAFETY (real money): if a tagged Loan/Advance being reversed
   *     has been partially settled (outstanding != amount), we BLOCK with a 409 rather
   *     than silently deleting a repaid obligation. FLAGGED for nexo/user review.
   *   - Whole thing is one $transaction — partial failure rolls the entire flip back.
   *   - CONCURRENCY (lost-update / double-spend): the status flip is a COMPARE-AND-SWAP —
   *     a conditional updateMany WHERE {id, status: <status we read>} runs FIRST inside the
   *     txn; the effect runs ONLY if it matched exactly one row (flipped.count===1). Two
   *     overlapping re-decides therefore cannot both apply the effect — the loser matches
   *     0 rows and throws 409, and its txn (with any effect) rolls back. Exactly ONE
   *     tagged Loan/Advance/attendance-set results, never two.
   */
  async redecide(
    id: string,
    input: RedecideInput,
    resolvedById: string,
  ): Promise<WorkerRequest> {
    const current = await prisma.workerRequest.findUnique({ where: { id } });
    if (!current) throw AppError.notFound('Request not found');

    // Re-decide is the RESOLVED→other path. A still-PENDING request must go through the
    // normal approve/reject endpoints (fail-closed: we never resolve a PENDING here).
    if (current.status === RequestStatus.PENDING) {
      throw AppError.conflict(
        'Request is still PENDING; use approve/reject, not re-decide',
      );
    }
    // Same-status re-decide is a no-op we reject explicitly to avoid double-apply /
    // double-reverse of the side effect.
    if (current.status === input.status) {
      throw AppError.conflict(`Request is already ${input.status}`);
    }

    const row = await prisma.$transaction(async (tx) => {
      // COMPARE-AND-SWAP (lost-update / double-spend protection). The precondition read
      // above is OUTSIDE the txn (and the default isolation is READ COMMITTED), so two
      // overlapping re-decides could both observe the same source status and each run the
      // effect → duplicate side effect (e.g. two tagged Loans = double money owed). We
      // guard the flip with a CONDITIONAL updateMany that fires ONLY if the row is STILL
      // in the status we read; the loser matches 0 rows, throws 409, and its whole txn
      // (including any not-yet-run effect) rolls back. The effect is applied ONLY AFTER a
      // winning flip, so a concurrent re-approve can never create a second tagged row.
      const flipped = await tx.workerRequest.updateMany({
        where: { id, status: current.status }, // only if unchanged since we read it
        data: {
          status: input.status,
          resolvedById, // re-stamped to the caller every time (un-spoofable).
          resolvedAt: new Date(),
          resolutionNotes: input.resolutionNotes ?? null,
        },
      });
      if (flipped.count === 0) {
        // Someone else re-decided this request between our read and this write.
        throw AppError.conflict('Request state changed concurrently');
      }

      // We WON the flip — now materialize the effect. Runs after the guarded status
      // change, still inside the same txn, so a failure here rolls the flip back too.
      if (input.status === RequestStatus.REJECTED) {
        // APPROVED → REJECTED: reverse the side effect by requestId.
        await this.reverseApprovalEffect(tx, current);
      } else {
        // REJECTED → APPROVED: re-apply via the SAME tagged-create path as a normal
        // approve, so new records are created AND tagged with requestId.
        await this.applyApprovalEffect(tx, current);
      }

      // Re-read the flipped row for the response (updateMany returns a count, not the row).
      return tx.workerRequest.findUniqueOrThrow({ where: { id } });
    });

    return mapRequest(row);
  }

  /**
   * Reverse the materialized effect of a previously-approved request by deleting ONLY
   * the rows TAGGED to this request (requestId = req.id). Runs inside the redecide
   * transaction. Blocks (409) if a tagged Loan/Advance has been partially settled so we
   * never silently delete a partially-repaid obligation.
   */
  private async reverseApprovalEffect(
    tx: Prisma.TransactionClient,
    req: PWorkerRequest,
  ): Promise<void> {
    if (req.type === RequestType.LOAN) {
      const loans = await tx.loan.findMany({ where: { requestId: req.id } });
      for (const l of loans) {
        // PARTIAL-REPAYMENT GUARD: outstanding != amount ⇒ already settled in part.
        if (l.outstanding.toString() !== l.amount.toString()) {
          throw AppError.conflict(
            'Cannot reverse: the loan created by this request has been partially repaid',
          );
        }
      }
      await tx.loan.deleteMany({ where: { requestId: req.id } });
      return;
    }

    if (req.type === RequestType.ADVANCE) {
      const advances = await tx.advancePayment.findMany({ where: { requestId: req.id } });
      for (const a of advances) {
        if (a.outstanding.toString() !== a.amount.toString()) {
          throw AppError.conflict(
            'Cannot reverse: the advance created by this request has been partially settled',
          );
        }
      }
      await tx.advancePayment.deleteMany({ where: { requestId: req.id } });
      return;
    }

    if (req.type === RequestType.VACATION) {
      // Remove ONLY the attendance days this approval created (tagged). Days that
      // pre-existed (skipped at approval time) were never tagged → never touched.
      await tx.attendanceRecord.deleteMany({ where: { requestId: req.id } });
    }
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
            // TAG: bind this record to the approving request for SAFE reversal.
            requestId: req.id,
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
        // TAG: bind this ledger row to the approving request for SAFE reversal.
        requestId: req.id,
      };
      if (req.type === RequestType.LOAN) {
        await tx.loan.create({ data });
      } else {
        await tx.advancePayment.create({ data });
      }
    }
  }
}
