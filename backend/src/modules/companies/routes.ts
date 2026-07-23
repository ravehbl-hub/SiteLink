/**
 * SiteLink back end — System-Admin Company routes (multi-tenancy Phase 1).
 * ADMIN-ONLY (BACKOFFICE_ROLES = [ADMIN]). A MANAGER/FOREMAN/WORKER/PARTNER token
 * → 403 on every route (enforced by the shared `guard` preHandler — the coarse gate;
 * there is no company-scoped read here because ADMIN is cross-company by definition).
 *
 *   GET   /companies                 list (?includeArchived) Paginated
 *   POST  /companies                 create (name + billing contact/lifecycle)
 *   GET   /companies/:id             get one
 *   PATCH /companies/:id             update
 *   POST  /companies/:id/archive     soft-delete (retire tenant)
 *   POST  /companies/:id/unarchive   restore
 *
 * Creating a MANAGER INTO a company is NOT here — it is POST /users with an ADMIN
 * supplying companyId (modules/users).
 */
import type { FastifyInstance } from 'fastify';
import { createCompanySchema, updateCompanySchema } from '@sitelink/shared';
import { BACKOFFICE_ROLES } from '../../plugins/auth.js';
import { CompaniesService } from './service.js';
import { idParam, listCompaniesQuerySchema } from './schemas.js';

export async function companyRoutes(app: FastifyInstance): Promise<void> {
  const service = new CompaniesService();
  const guard = { preHandler: [app.authenticate, app.requireRole(...BACKOFFICE_ROLES)] };

  app.get('/companies', guard, async (req) => {
    const query = listCompaniesQuerySchema.parse(req.query);
    return service.list(query);
  });

  app.post('/companies', guard, async (req, reply) => {
    const body = createCompanySchema.parse(req.body);
    const created = await service.create(body);
    return reply.status(201).send(created);
  });

  app.get('/companies/:id', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    return service.get(id);
  });

  app.patch('/companies/:id', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = updateCompanySchema.parse(req.body);
    return service.update(id, body);
  });

  app.post('/companies/:id/archive', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    return service.archive(id);
  });

  app.post('/companies/:id/unarchive', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    return service.unarchive(id);
  });
}
