/**
 * SiteLink back end — workers routes (FR-MGR-EMP). Manager/Admin-gated.
 *   GET    /workers                     list (?includeArchived, ?archivedOnly, ?siteId)
 *   POST   /workers                     Worker Wizard create
 *   GET    /workers/:id                 details (Details + Docs + Salary)
 *   PATCH  /workers/:id                 modify
 *   POST   /workers/:id/archive         archive
 *   POST   /workers/:id/unarchive       restore (unarchive)
 *   DELETE /workers/:id                 remove
 *   PUT    /workers/:id/salary-data     upsert salary data
 *   GET    /workers/:id/docs            list docs
 *   POST   /workers/:id/docs/upload-url mint signed upload URL
 *   POST   /workers/:id/docs            confirm upload → persist FileRef
 *   GET    /workers/:id/docs/:docId/url mint signed read URL
 *   DELETE /workers/:id/docs/:docId     remove doc (+ storage object)
 *   POST   /workers/:id/image/upload-url mint signed image upload URL
 *   POST   /workers/:id/image           confirm image upload → Worker.image FileRef
 *   GET    /workers/:id/image/url        mint signed image read URL
 */
import type { FastifyInstance } from 'fastify';
import { FOREMAN_ROLES, MANAGER_ROLES } from '../../plugins/auth.js';
import { WorkersService } from './service.js';
import {
  confirmDocSchema,
  confirmImageSchema,
  createWorkerSchema,
  docParam,
  idParam,
  listWorkersQuery,
  requestDocUploadSchema,
  requestImageUploadSchema,
  salaryDataSchema,
  updateWorkerSchema,
} from './schemas.js';

export async function workerRoutes(app: FastifyInstance): Promise<void> {
  const service = new WorkersService(app.supabase);
  const guard = { preHandler: [app.authenticate, app.requireRole(...MANAGER_ROLES)] };
  // FOREMAN-eligible surfaces (LIST/VIEW/ADD/EDIT). FOREMAN_ROLES is only the COARSE
  // gate; each handler passes req.appUser! into the service so the SERVICE applies the
  // fine-grained site-scope boundary (lib/scope). ADMIN/MANAGER stay UNSCOPED. Every
  // OTHER worker route (archive/remove/salary/docs/image) keeps the MANAGER-only guard.
  const foremanGuard = {
    preHandler: [app.authenticate, app.requireRole(...FOREMAN_ROLES)],
  };

  app.get('/workers', foremanGuard, async (req) => {
    const query = listWorkersQuery.parse(req.query);
    return service.list(query, req.appUser!);
  });

  app.post('/workers', foremanGuard, async (req, reply) => {
    const body = createWorkerSchema.parse(req.body);
    const worker = await service.create(body, req.appUser!);
    return reply.status(201).send(worker);
  });

  app.get('/workers/:id', foremanGuard, async (req) => {
    const { id } = idParam.parse(req.params);
    return service.getWithDetails(id, req.appUser!);
  });

  app.patch('/workers/:id', foremanGuard, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = updateWorkerSchema.parse(req.body);
    return service.update(id, body, req.appUser!);
  });

  app.post('/workers/:id/archive', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    return service.archive(id, req.appUser!);
  });

  // Restore an archived worker. MANAGER-only (same `guard` as archive) — a FOREMAN can
  // VIEW archived workers via GET /workers?archivedOnly but cannot restore them.
  app.post('/workers/:id/unarchive', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    return service.unarchive(id, req.appUser!);
  });

  app.delete('/workers/:id', guard, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    await service.remove(id, req.appUser!);
    return reply.status(204).send();
  });

  app.put('/workers/:id/salary-data', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = salaryDataSchema.parse(req.body);
    return service.upsertSalaryData(id, body, req.appUser!);
  });

  // ── Docs ──────────────────────────────────────────────────────────────
  app.get('/workers/:id/docs', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    return service.listDocs(id, req.appUser!);
  });

  app.post('/workers/:id/docs/upload-url', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = requestDocUploadSchema.parse(req.body);
    return service.requestDocUpload(id, body, req.appUser!);
  });

  app.post('/workers/:id/docs', guard, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const body = confirmDocSchema.parse(req.body);
    const doc = await service.confirmDoc(id, body, req.appUser!);
    return reply.status(201).send(doc);
  });

  app.get('/workers/:id/docs/:docId/url', guard, async (req) => {
    const { id, docId } = docParam.parse(req.params);
    return service.getDocReadUrl(id, docId, req.appUser!);
  });

  app.delete('/workers/:id/docs/:docId', guard, async (req, reply) => {
    const { id, docId } = docParam.parse(req.params);
    await service.removeDoc(id, docId, req.appUser!);
    return reply.status(204).send();
  });

  // ── Profile image (symmetric to docs) ───────────────────────────────────
  // FOREMAN-eligible (site-scoped), mirroring VIEW/EDIT: FOREMAN_ROLES is the coarse
  // gate; each handler passes req.appUser! so the SERVICE applies assertWorkerInScope
  // (a FOREMAN may only touch images for a worker on one of their union sites; 403
  // otherwise). ADMIN/MANAGER stay UNSCOPED. Only these 3 image routes are widened —
  // archive/remove/salary/docs remain MANAGER-only.
  app.post('/workers/:id/image/upload-url', foremanGuard, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = requestImageUploadSchema.parse(req.body);
    return service.requestImageUpload(id, body, req.appUser!);
  });

  app.post('/workers/:id/image', foremanGuard, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = confirmImageSchema.parse(req.body);
    return service.confirmImage(id, body, req.appUser!);
  });

  app.get('/workers/:id/image/url', foremanGuard, async (req) => {
    const { id } = idParam.parse(req.params);
    return service.getImageReadUrl(id, req.appUser!);
  });
}
