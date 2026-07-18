/**
 * SiteLink back end — personnel-companies routes (staffing companies CRUD).
 *
 * ADMIN/MANAGER only — every route is gated by requireRole(...MANAGER_ROLES). NOT
 * Foreman-eligible and NOT site-scoped (org-wide entity, no lib/scope). Foreman and
 * Worker callers get a terse 403 at the coarse gate.
 *
 *   GET    /personnel-companies             list (?includeArchived, page, pageSize)
 *   POST   /personnel-companies             create (name unique → 409 on duplicate)
 *   GET    /personnel-companies/:id         get one (404 if missing)
 *   PATCH  /personnel-companies/:id         update (partial; name unique → 409)
 *   POST   /personnel-companies/:id/archive     set isArchived true
 *   POST   /personnel-companies/:id/unarchive   set isArchived false
 */
import type { FastifyInstance } from 'fastify';
import { MANAGER_ROLES } from '../../plugins/auth.js';
import { PersonnelCompaniesService } from './service.js';
import {
  createPersonnelCompanySchema,
  idParam,
  listPersonnelCompaniesQuery,
  updatePersonnelCompanySchema,
} from './schemas.js';

export async function personnelCompanyRoutes(app: FastifyInstance): Promise<void> {
  const service = new PersonnelCompaniesService();
  // MANAGER-only gate on EVERY route (ADMIN + MANAGER). No Foreman surface here.
  const guard = { preHandler: [app.authenticate, app.requireRole(...MANAGER_ROLES)] };

  app.get('/personnel-companies', guard, async (req) => {
    const query = listPersonnelCompaniesQuery.parse(req.query);
    return service.list(query);
  });

  app.post('/personnel-companies', guard, async (req, reply) => {
    const body = createPersonnelCompanySchema.parse(req.body);
    const created = await service.create(body);
    return reply.status(201).send(created);
  });

  app.get('/personnel-companies/:id', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    return service.get(id);
  });

  app.patch('/personnel-companies/:id', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = updatePersonnelCompanySchema.parse(req.body);
    return service.update(id, body);
  });

  app.post('/personnel-companies/:id/archive', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    return service.archive(id);
  });

  app.post('/personnel-companies/:id/unarchive', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    return service.unarchive(id);
  });
}
