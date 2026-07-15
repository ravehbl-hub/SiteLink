/**
 * SiteLink back end — foreman-assignments routes (Foreman multi-site). MANAGER/Admin.
 *   POST   /foreman-assignments            assign (upsert/reactivate) a foreman↔site
 *   DELETE /foreman-assignments            unassign a foreman↔site (?foremanId&siteId)
 *   GET    /foreman-assignments?foremanId= list a foreman's ACTIVE assignments
 *
 * MANAGER_ROLES (ADMIN + MANAGER) gated — a WORKER/FOREMAN calling these gets 403 at
 * requireRole. Managing a foreman's multi-site scope is a back-office privilege; a
 * foreman can never widen their OWN scope.
 */
import type { FastifyInstance } from 'fastify';
import { createForemanSiteAssignmentSchema } from '@sitelink/shared';
import { MANAGER_ROLES } from '../../plugins/auth.js';
import { ForemanAssignmentsService } from './service.js';
import { listForemanAssignmentsQuery, unassignForemanQuery } from './schemas.js';

export async function foremanAssignmentRoutes(app: FastifyInstance): Promise<void> {
  const service = new ForemanAssignmentsService();
  const guard = { preHandler: [app.authenticate, app.requireRole(...MANAGER_ROLES)] };

  app.post('/foreman-assignments', guard, async (req, reply) => {
    const body = createForemanSiteAssignmentSchema.parse(req.body);
    const assignment = await service.assign(body);
    return reply.status(201).send(assignment);
  });

  app.delete('/foreman-assignments', guard, async (req) => {
    const query = unassignForemanQuery.parse(req.query);
    return service.unassign(query);
  });

  app.get('/foreman-assignments', guard, async (req) => {
    const { foremanId } = listForemanAssignmentsQuery.parse(req.query);
    return service.listForForeman(foremanId);
  });
}
