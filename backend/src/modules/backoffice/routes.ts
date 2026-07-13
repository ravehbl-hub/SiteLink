/**
 * SiteLink back end — Back Office routes (PRD §10 FR-BO). ADMIN-only this phase.
 *   GET /backoffice/status        system status (liveness + DB probe; no secrets)
 *   GET /backoffice/users         users list + basic activity (existing User table)
 *   GET /backoffice/profit-loss   P&L, reusing FinanceService (business-wide/site)
 *
 * Customers / billing / usage are DELIBERATELY not exposed — those UIs are stubbed
 * client-side (no new business logic this phase). BACKOFFICE_ROLES = [ADMIN].
 */
import type { FastifyInstance } from 'fastify';
import { BACKOFFICE_ROLES } from '../../plugins/auth.js';
import { FinanceService } from '../finance/service.js';
import { profitLossQuery } from '../finance/schemas.js';
import { BackOfficeService } from './service.js';

export async function backOfficeRoutes(app: FastifyInstance): Promise<void> {
  const service = new BackOfficeService();
  const finance = new FinanceService();
  const guard = { preHandler: [app.authenticate, app.requireRole(...BACKOFFICE_ROLES)] };

  app.get('/backoffice/status', guard, async () => service.systemStatus());

  app.get('/backoffice/users', guard, async () => service.users());

  app.get('/backoffice/profit-loss', guard, async (req) => {
    const query = profitLossQuery.parse(req.query);
    return finance.profitLoss(query);
  });
}
