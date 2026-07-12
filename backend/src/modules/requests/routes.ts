/**
 * SiteLink back end — requests routes (FR-REQ — modeled). Manager/Admin-gated.
 *   GET  /requests               list (?workerId,?status)
 *   POST /requests               create
 *   PATCH /requests/:id/approve  approve
 *   PATCH /requests/:id/reject   reject
 */
import type { FastifyInstance } from 'fastify';
import { RequestStatus } from '@sitelink/shared';
import { MANAGER_ROLES } from '../../plugins/auth.js';
import { RequestsService } from './service.js';
import {
  createRequestSchema,
  idParam,
  listRequestsQuery,
  resolveRequestSchema,
} from './schemas.js';

export async function requestRoutes(app: FastifyInstance): Promise<void> {
  const service = new RequestsService();
  const guard = { preHandler: [app.authenticate, app.requireRole(...MANAGER_ROLES)] };

  app.get('/requests', guard, async (req) => {
    const query = listRequestsQuery.parse(req.query);
    return service.list(query);
  });

  app.post('/requests', guard, async (req, reply) => {
    const body = createRequestSchema.parse(req.body);
    return reply.status(201).send(await service.create(body));
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
}
