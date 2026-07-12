/**
 * SiteLink back end — requests service (FR-REQ — modeled, Manager-gated).
 * Create + approve/reject. The Worker-initiated flow is v2; here the Manager can
 * model and resolve requests.
 */
import type { z } from 'zod';
import type { Paginated, WorkerRequest } from '@sitelink/shared';
import { RequestStatus } from '@sitelink/shared';
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

  async create(input: CreateInput): Promise<WorkerRequest> {
    const row = await prisma.workerRequest.create({
      data: {
        workerId: input.workerId,
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

  /** Approve or reject. `resolvedById` is the acting Manager/Admin user. */
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
    const row = await prisma.workerRequest.update({
      where: { id },
      data: {
        status: input.status,
        resolvedById,
        resolvedAt: new Date(),
        resolutionNotes: input.resolutionNotes ?? null,
      },
    });
    return mapRequest(row);
  }
}
