/**
 * SiteLink back end — sites routes (FR-MGR-SITE). Manager/Admin-gated.
 *   GET    /sites            list (?includeArchived)
 *   POST   /sites            add
 *   GET    /sites/:id        get
 *   PATCH  /sites/:id        modify
 *   POST   /sites/:id/archive  archive (soft-delete)
 *   DELETE /sites/:id        remove (hard delete)
 */
import type { FastifyInstance } from 'fastify';
import { MANAGER_ROLES } from '../../plugins/auth.js';
import { SitesService } from './service.js';
import { createSiteSchema, idParam, listSitesQuery, updateSiteSchema } from './schemas.js';

export async function siteRoutes(app: FastifyInstance): Promise<void> {
  const service = new SitesService();
  const guard = { preHandler: [app.authenticate, app.requireRole(...MANAGER_ROLES)] };

  app.get('/sites', guard, async (req) => {
    const query = listSitesQuery.parse(req.query);
    return service.list(query);
  });

  app.post('/sites', guard, async (req, reply) => {
    const body = createSiteSchema.parse(req.body);
    const site = await service.create(body);
    return reply.status(201).send(site);
  });

  app.get('/sites/:id', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    return service.get(id);
  });

  app.patch('/sites/:id', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = updateSiteSchema.parse(req.body);
    return service.update(id, body);
  });

  app.post('/sites/:id/archive', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    return service.archive(id);
  });

  app.delete('/sites/:id', guard, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    await service.remove(id);
    return reply.status(204).send();
  });
}
