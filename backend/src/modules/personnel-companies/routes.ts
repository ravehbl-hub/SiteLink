/**
 * SiteLink back end — personnel-companies routes (staffing companies CRUD).
 *
 * READS (list + get one) are ADMIN/MANAGER/FOREMAN — a FOREMAN needs the company list
 * to populate its worker-wizard picker (org-wide entity, no site scope). WRITES
 * (create/update/archive/unarchive) stay MANAGER-only (ADMIN + MANAGER). The exposed
 * fields (name/contactName/phone/email) are contact info the foreman legitimately
 * needs — no secret/key/password. A WORKER caller is 403 everywhere.
 *
 *   GET    /personnel-companies             list  — FOREMAN_ROLES (read-only picker)
 *   POST   /personnel-companies             create (MANAGER; name unique → 409)
 *   GET    /personnel-companies/:id         get one — FOREMAN_ROLES (404 if missing)
 *   PATCH  /personnel-companies/:id         update (MANAGER; partial; name unique → 409)
 *   POST   /personnel-companies/:id/archive     (MANAGER) set isArchived true
 *   POST   /personnel-companies/:id/unarchive   (MANAGER) set isArchived false
 *   DELETE /personnel-companies/:id         HARD delete (MANAGER; 204; 404 if missing)
 *
 * DELETE is a HARD delete: the row is gone. Workers linked via personnelCompanyId are
 * automatically un-linked by the FK (onDelete: SetNull) — not deleted — and keep their
 * free-text `personnelCompany` mirror value. Deletion is never blocked on linked workers.
 */
import type { FastifyInstance } from 'fastify';
import { FOREMAN_ROLES, MANAGER_ROLES } from '../../plugins/auth.js';
import { PersonnelCompaniesService } from './service.js';
import {
  createPersonnelCompanySchema,
  idParam,
  listPersonnelCompaniesQuery,
  updatePersonnelCompanySchema,
} from './schemas.js';

export async function personnelCompanyRoutes(app: FastifyInstance): Promise<void> {
  const service = new PersonnelCompaniesService();
  // WRITE gate — MANAGER-only (ADMIN + MANAGER).
  const guard = { preHandler: [app.authenticate, app.requireRole(...MANAGER_ROLES)] };
  // READ gate — ADMIN + MANAGER + FOREMAN (foreman picker is read-only).
  const readGuard = { preHandler: [app.authenticate, app.requireRole(...FOREMAN_ROLES)] };

  app.get('/personnel-companies', readGuard, async (req) => {
    const query = listPersonnelCompaniesQuery.parse(req.query);
    return service.list(query, req.appUser!);
  });

  app.post('/personnel-companies', guard, async (req, reply) => {
    const body = createPersonnelCompanySchema.parse(req.body);
    const created = await service.create(body, req.appUser!);
    return reply.status(201).send(created);
  });

  app.get('/personnel-companies/:id', readGuard, async (req) => {
    const { id } = idParam.parse(req.params);
    return service.get(id, req.appUser!);
  });

  app.patch('/personnel-companies/:id', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = updatePersonnelCompanySchema.parse(req.body);
    return service.update(id, body, req.appUser!);
  });

  app.post('/personnel-companies/:id/archive', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    return service.archive(id, req.appUser!);
  });

  app.post('/personnel-companies/:id/unarchive', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    return service.unarchive(id, req.appUser!);
  });

  // HARD delete (MANAGER-only `guard`). 204 on success (workers DELETE convention).
  // Linked workers are un-linked by the FK (onDelete: SetNull), never deleted.
  app.delete('/personnel-companies/:id', guard, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    await service.remove(id, req.appUser!);
    return reply.status(204).send();
  });
}
