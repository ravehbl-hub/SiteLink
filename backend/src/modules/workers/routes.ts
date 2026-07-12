/**
 * SiteLink back end — workers routes (FR-MGR-EMP). Manager/Admin-gated.
 *   GET    /workers                     list (?includeArchived, ?siteId)
 *   POST   /workers                     Worker Wizard create
 *   GET    /workers/:id                 details (Details + Docs + Salary)
 *   PATCH  /workers/:id                 modify
 *   POST   /workers/:id/archive         archive
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
import { MANAGER_ROLES } from '../../plugins/auth.js';
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

  app.get('/workers', guard, async (req) => {
    const query = listWorkersQuery.parse(req.query);
    return service.list(query);
  });

  app.post('/workers', guard, async (req, reply) => {
    const body = createWorkerSchema.parse(req.body);
    const worker = await service.create(body);
    return reply.status(201).send(worker);
  });

  app.get('/workers/:id', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    return service.getWithDetails(id);
  });

  app.patch('/workers/:id', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = updateWorkerSchema.parse(req.body);
    return service.update(id, body);
  });

  app.post('/workers/:id/archive', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    return service.archive(id);
  });

  app.delete('/workers/:id', guard, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    await service.remove(id);
    return reply.status(204).send();
  });

  app.put('/workers/:id/salary-data', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = salaryDataSchema.parse(req.body);
    return service.upsertSalaryData(id, body);
  });

  // ── Docs ──────────────────────────────────────────────────────────────
  app.get('/workers/:id/docs', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    return service.listDocs(id);
  });

  app.post('/workers/:id/docs/upload-url', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = requestDocUploadSchema.parse(req.body);
    return service.requestDocUpload(id, body);
  });

  app.post('/workers/:id/docs', guard, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const body = confirmDocSchema.parse(req.body);
    const doc = await service.confirmDoc(id, body);
    return reply.status(201).send(doc);
  });

  app.get('/workers/:id/docs/:docId/url', guard, async (req) => {
    const { id, docId } = docParam.parse(req.params);
    return service.getDocReadUrl(id, docId);
  });

  app.delete('/workers/:id/docs/:docId', guard, async (req, reply) => {
    const { id, docId } = docParam.parse(req.params);
    await service.removeDoc(id, docId);
    return reply.status(204).send();
  });

  // ── Profile image (symmetric to docs) ───────────────────────────────────
  app.post('/workers/:id/image/upload-url', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = requestImageUploadSchema.parse(req.body);
    return service.requestImageUpload(id, body);
  });

  app.post('/workers/:id/image', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = confirmImageSchema.parse(req.body);
    return service.confirmImage(id, body);
  });

  app.get('/workers/:id/image/url', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    return service.getImageReadUrl(id);
  });
}
