/**
 * SiteLink back end — requests routes (FR-REQ). ADMIN/MANAGER manage the full loop;
 * a WORKER may self-submit and read ONLY their own requests (never approve/reject).
 *   GET  /requests               list (?workerId,?status)  — WORKER self-scoped
 *   POST /requests               create                    — WORKER self-scoped
 *   PATCH /requests/:id/approve  approve                   — ADMIN/MANAGER only
 *   PATCH /requests/:id/reject   reject                    — ADMIN/MANAGER only
 *   PATCH /requests/:id/redecide re-decide RESOLVED→other  — ADMIN/MANAGER only
 */
import type { FastifyInstance } from 'fastify';
import { RequestStatus, Role } from '@sitelink/shared';
import { MANAGER_ROLES } from '../../plugins/auth.js';
import { requireWorkerId } from '../../lib/scope.js';
import { RequestsService } from './service.js';
import {
  createRequestSchema,
  idParam,
  listRequestsQuery,
  redecideRequestSchema,
  resolveRequestSchema,
} from './schemas.js';

export async function requestRoutes(app: FastifyInstance): Promise<void> {
  const service = new RequestsService();
  const guard = { preHandler: [app.authenticate, app.requireRole(...MANAGER_ROLES)] };
  // list + create additionally allow WORKER (self-scoped in-handler). approve/reject
  // stay on `guard` (ADMIN/MANAGER only) — a WORKER can never resolve a request.
  const selfGuard = {
    preHandler: [app.authenticate, app.requireRole(...MANAGER_ROLES, Role.WORKER)],
  };

  app.get('/requests', selfGuard, async (req) => {
    const query = listRequestsQuery.parse(req.query);
    if (req.appUser!.role === Role.WORKER) {
      // A WORKER sees only their own requests. No linked Worker → empty page.
      const selfWorkerId = await requireWorkerId(req.appUser!);
      return service.list(query, selfWorkerId);
    }
    return service.list(query);
  });

  app.post('/requests', selfGuard, async (req, reply) => {
    const body = createRequestSchema.parse(req.body);
    if (req.appUser!.role === Role.WORKER) {
      // Worker-initiated: workerId forced to the caller's resolved Worker (fail-closed
      // 403 if unlinked); requestedById = the worker's own user; status PENDING.
      const selfWorkerId = await requireWorkerId(req.appUser!);
      return reply
        .status(201)
        .send(await service.create(body, req.appUser!.id, selfWorkerId));
    }
    // ADMIN/MANAGER model a request on a worker's behalf; requestedById = acting user.
    return reply.status(201).send(await service.create(body, req.appUser!.id));
  });

  app.patch('/requests/:id/approve', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = resolveRequestSchema.parse({
      status: RequestStatus.APPROVED,
      resolutionNotes: (req.body as { resolutionNotes?: string } | undefined)
        ?.resolutionNotes,
    });
    return service.resolve(id, body, req.appUser!.id);
  });

  app.patch('/requests/:id/reject', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = resolveRequestSchema.parse({
      status: RequestStatus.REJECTED,
      resolutionNotes: (req.body as { resolutionNotes?: string } | undefined)
        ?.resolutionNotes,
    });
    return service.resolve(id, body, req.appUser!.id);
  });

  // RE-DECIDE an already-RESOLVED request (ADMIN/MANAGER only). Flips APPROVED↔REJECTED
  // and reverses/re-applies the side effect atomically (reverse-by-requestId). Body is
  // Zod-validated to { status: APPROVED|REJECTED, resolutionNotes? }; resolvedById is
  // ALWAYS the acting user (server-derived), never from the body; the effect's
  // amount/worker/dates come from the ORIGINAL request row.
  app.patch('/requests/:id/redecide', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = redecideRequestSchema.parse(req.body);
    return service.redecide(id, body, req.appUser!.id);
  });
}
