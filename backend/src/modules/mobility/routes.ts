/**
 * SiteLink back end — employee-mobility routes. ADMIN/MANAGER-gated.
 *   POST /mobility/transfer   move a worker to another site + update presence
 *
 * FOREMAN is intentionally NOT on this surface: mobility re-points a worker onto a
 * (possibly cross-site) destination and is a manager-level operation. The service is
 * still company-scoped, so a MANAGER can only move workers within their own company.
 */
import type { FastifyInstance } from 'fastify';
import { MANAGER_ROLES } from '../../plugins/auth.js';
import { MobilityService } from './service.js';
import { transferSchema } from './schemas.js';

export async function mobilityRoutes(app: FastifyInstance): Promise<void> {
  const service = new MobilityService();
  const guard = { preHandler: [app.authenticate, app.requireRole(...MANAGER_ROLES)] };

  app.post('/mobility/transfer', guard, async (req, reply) => {
    const body = transferSchema.parse(req.body);
    const result = await service.transfer(body, req.appUser!);
    return reply.status(201).send(result);
  });
}
