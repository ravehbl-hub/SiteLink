/**
 * SiteLink back end — worker ratings routes (FR-FOR-5). FOREMAN_ROLES-gated.
 *   GET  /workers/:id/ratings   list a worker's ratings (scoped to caller's site)
 *   POST /workers/:id/ratings   create a rating (foremanId = caller; site-scoped)
 *
 * The `:id` path param is the worker id and is authoritative; a body `workerId` (if
 * any) is reconciled to the path so the two cannot disagree. foremanId is derived
 * server-side. Mounted alongside the workers module under /api/v1.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createWorkerRatingSchema } from '@sitelink/shared';
import { FOREMAN_ROLES } from '../../plugins/auth.js';
import { RatingsService } from './service.js';

const idParam = z.object({ id: z.string().min(1) });

export async function ratingRoutes(app: FastifyInstance): Promise<void> {
  const service = new RatingsService();
  const guard = { preHandler: [app.authenticate, app.requireRole(...FOREMAN_ROLES)] };

  app.get('/workers/:id/ratings', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    return service.listForWorker(id, req.appUser!);
  });

  app.post('/workers/:id/ratings', guard, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    // Path id is authoritative; ignore/override any body workerId.
    const body = createWorkerRatingSchema.parse({
      ...(req.body as Record<string, unknown>),
      workerId: id,
    });
    const rating = await service.create(body, req.appUser!);
    return reply.status(201).send(rating);
  });
}
