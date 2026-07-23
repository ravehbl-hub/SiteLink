/**
 * SiteLink back end — Back Office routes (PRD §10 FR-BO). ADMIN-only this phase.
 *   GET   /backoffice/status                    system status (liveness + DB probe)
 *   GET   /backoffice/users                     users list + basic activity
 *   GET   /backoffice/profit-loss               P&L (FinanceService, business/site)
 *
 * SaaS business layer (FR-BO-2) — Billing / Usage, keyed by the tenant Company (the
 * former standalone `Customer` model was MERGED into Company — Option C; company
 * lifecycle CRUD lives under /companies):
 *   GET   /backoffice/billing (?companyId)      list Paginated
 *   POST  /backoffice/billing                   create
 *   GET   /backoffice/usage (?companyId,?metric) list Paginated
 *   POST  /backoffice/usage                     create
 *
 * ALL routes are BACKOFFICE_ROLES = [ADMIN]. A MANAGER/PARTNER/FOREMAN/WORKER
 * token → 403 (enforced by the shared `guard` preHandler).
 */
import type { FastifyInstance } from 'fastify';
import { createBillingSchema, createUsageSchema } from '@sitelink/shared';
import { BACKOFFICE_ROLES } from '../../plugins/auth.js';
import { FinanceService } from '../finance/service.js';
import { profitLossQuery } from '../finance/schemas.js';
import { BackOfficeService } from './service.js';
import { BackOfficeBillingService } from './billing-service.js';
import { listBillingQuery, listUsageQuery } from './schemas.js';

export async function backOfficeRoutes(app: FastifyInstance): Promise<void> {
  const service = new BackOfficeService();
  const finance = new FinanceService();
  const billingService = new BackOfficeBillingService();
  const guard = { preHandler: [app.authenticate, app.requireRole(...BACKOFFICE_ROLES)] };

  app.get('/backoffice/status', guard, async () => service.systemStatus());

  app.get('/backoffice/users', guard, async () => service.users());

  app.get('/backoffice/profit-loss', guard, async (req) => {
    const query = profitLossQuery.parse(req.query);
    return finance.profitLoss(query);
  });

  // ─── Billing ────────────────────────────────────────────────────────────
  app.get('/backoffice/billing', guard, async (req) => {
    const query = listBillingQuery.parse(req.query);
    return billingService.listBilling(query);
  });

  app.post('/backoffice/billing', guard, async (req, reply) => {
    const body = createBillingSchema.parse(req.body);
    const created = await billingService.createBilling(body);
    return reply.status(201).send(created);
  });

  // ─── Usage ──────────────────────────────────────────────────────────────
  app.get('/backoffice/usage', guard, async (req) => {
    const query = listUsageQuery.parse(req.query);
    return billingService.listUsage(query);
  });

  app.post('/backoffice/usage', guard, async (req, reply) => {
    const body = createUsageSchema.parse(req.body);
    const created = await billingService.createUsage(body);
    return reply.status(201).send(created);
  });
}
