/**
 * SiteLink back end — dashboard routes (FR-MGR-DASH). Manager/Admin-gated.
 *   GET /dashboard  (?siteId,?from,?to,?revenue,?currency) → DashboardRollup
 *
 * Manager-gated (ADMIN+MANAGER). The rollup carries finance metrics, so it follows
 * the same authz stance as the rest of the Manager surface. (PARTNER read is exposed
 * separately on /profit-loss; the full dashboard stays Manager/Admin.)
 */
import type { FastifyInstance } from 'fastify';
import { MANAGER_ROLES } from '../../plugins/auth.js';
import { DashboardService } from './service.js';
import { dashboardQuery } from './schemas.js';

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  const service = new DashboardService();
  const guard = { preHandler: [app.authenticate, app.requireRole(...MANAGER_ROLES)] };

  app.get('/dashboard', guard, async (req) => {
    const query = dashboardQuery.parse(req.query);
    return service.rollup(query);
  });
}
