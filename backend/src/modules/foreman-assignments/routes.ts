/**
 * SiteLink back end — foreman-assignments routes (Foreman multi-site). MANAGER/Admin.
 *   POST   /foreman-assignments            assign (upsert/reactivate) a foreman↔site
 *   DELETE /foreman-assignments            unassign a foreman↔site (?foremanId&siteId)
 *   GET    /foreman-assignments?foremanId= list a foreman's ACTIVE assignments
 *   GET    /foreman-sites                  SELF: caller foreman's pickable site union
 *
 * MANAGER_ROLES (ADMIN + MANAGER) gated — a WORKER/FOREMAN calling these gets 403 at
 * requireRole. Managing a foreman's multi-site scope is a back-office privilege; a
 * foreman can never widen their OWN scope.
 */
import type { FastifyInstance } from 'fastify';
import { createForemanSiteAssignmentSchema, Role } from '@sitelink/shared';
import { MANAGER_ROLES } from '../../plugins/auth.js';
import { ForemanAssignmentsService } from './service.js';
import { listForemanAssignmentsQuery, unassignForemanQuery } from './schemas.js';

export async function foremanAssignmentRoutes(app: FastifyInstance): Promise<void> {
  const service = new ForemanAssignmentsService();
  const guard = { preHandler: [app.authenticate, app.requireRole(...MANAGER_ROLES)] };

  // SELF surface: a FOREMAN reads THEIR OWN pickable site union (with names) for the
  // multi-site picker. FOREMAN-only — a WORKER/PARTNER → 403; ADMIN/MANAGER use the
  // Manager assignment surface above, not this self read. The union is derived from
  // req.appUser (server truth) in the service; no client-supplied foremanId exists.
  const selfGuard = { preHandler: [app.authenticate, app.requireRole(Role.FOREMAN)] };
  app.get('/foreman-sites', selfGuard, async (req) => {
    return service.pickableSitesFor(req.appUser!);
  });

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
