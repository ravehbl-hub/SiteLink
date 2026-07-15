/**
 * SiteLink back end — dashboard routes (FR-MGR-DASH + FR-FOR). Role-scoped.
 *   GET /dashboard  (?siteId,?from,?to,?revenue,?currency) → DashboardRollup
 *
 * ADMIN/MANAGER: full rollup, any/all sites (unchanged). FOREMAN: the SAME rollup
 * but FORCED to their own site — the effective siteId is derived server-side from
 * req.appUser (see lib/scope.effectiveSiteId): a Foreman passing ?siteId=<other> →
 * 403; passing none → defaults to their assigned site. The client-supplied siteId is
 * NEVER trusted for a Foreman. (PARTNER stays out — full dashboard is not a read
 * surface for them; they use /profit-loss.)
 */
import type { FastifyInstance } from 'fastify';
import { FOREMAN_ROLES } from '../../plugins/auth.js';
import { effectiveSiteScope } from '../../lib/scope.js';
import { DashboardService } from './service.js';
import { dashboardQuery } from './schemas.js';

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  const service = new DashboardService();
  const guard = { preHandler: [app.authenticate, app.requireRole(...FOREMAN_ROLES)] };

  app.get('/dashboard', guard, async (req) => {
    const query = dashboardQuery.parse(req.query);
    // SECURITY: override the parsed siteId with the caller-scoped effective site set.
    // For a FOREMAN this throws 403 on a cross-site probe; a requested site narrows to
    // that site, none = their WHOLE union. ADMIN/MANAGER: requested narrows, none = all.
    const scope = await effectiveSiteScope(req.appUser!, query.siteId);
    return service.rollup({ ...query, siteId: query.siteId }, scope);
  });

  // Worker-count report — same site-scoping stance as /dashboard.
  app.get('/worker-count', guard, async (req) => {
    const { siteId: requested } = dashboardQuery.pick({ siteId: true }).parse(req.query);
    const scope = await effectiveSiteScope(req.appUser!, requested);
    return service.workerCount(scope);
  });
}
