/**
 * SiteLink back end — Back Office routes (PRD §10 FR-BO). ADMIN-only this phase.
 *   GET   /backoffice/status                    system status (liveness + DB probe)
 *   GET   /backoffice/users                     users list + basic activity
 *   GET   /backoffice/profit-loss               P&L (FinanceService, business/site)
 *
 * SaaS business layer (FR-BO-1/2/3) — Customers / Billing / Usage:
 *   GET   /backoffice/customers                 list (?includeArchived) Paginated
 *   GET   /backoffice/customers/:id             get one
 *   POST  /backoffice/customers                 create
 *   PATCH /backoffice/customers/:id             update
 *   POST  /backoffice/customers/:id/archive     soft-delete
 *   POST  /backoffice/customers/:id/unarchive   restore
 *   GET   /backoffice/billing (?customerId)     list Paginated
 *   POST  /backoffice/billing                   create
 *   GET   /backoffice/usage (?customerId,?metric) list Paginated
 *   POST  /backoffice/usage                     create
 *
 * ALL routes are BACKOFFICE_ROLES = [ADMIN]. A MANAGER/PARTNER/FOREMAN/WORKER
 * token → 403 (enforced by the shared `guard` preHandler).
 */
import type { FastifyInstance } from 'fastify';
import {
  createBillingSchema,
  createCustomerSchema,
  createUsageSchema,
  updateCustomerSchema,
} from '@sitelink/shared';
import { BACKOFFICE_ROLES } from '../../plugins/auth.js';
import { FinanceService } from '../finance/service.js';
import { profitLossQuery } from '../finance/schemas.js';
import { BackOfficeService } from './service.js';
import { CustomersService } from './customers-service.js';
import { idParam, listBillingQuery, listCustomersQuery, listUsageQuery } from './schemas.js';

export async function backOfficeRoutes(app: FastifyInstance): Promise<void> {
  const service = new BackOfficeService();
  const finance = new FinanceService();
  const customers = new CustomersService();
  const guard = { preHandler: [app.authenticate, app.requireRole(...BACKOFFICE_ROLES)] };

  app.get('/backoffice/status', guard, async () => service.systemStatus());

  app.get('/backoffice/users', guard, async () => service.users());

  app.get('/backoffice/profit-loss', guard, async (req) => {
    const query = profitLossQuery.parse(req.query);
    return finance.profitLoss(query);
  });

  // ─── Customers ──────────────────────────────────────────────────────────
  app.get('/backoffice/customers', guard, async (req) => {
    const query = listCustomersQuery.parse(req.query);
    return customers.listCustomers(query);
  });

  app.post('/backoffice/customers', guard, async (req, reply) => {
    const body = createCustomerSchema.parse(req.body);
    const created = await customers.createCustomer(body);
    return reply.status(201).send(created);
  });

  app.get('/backoffice/customers/:id', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    return customers.getCustomer(id);
  });

  app.patch('/backoffice/customers/:id', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = updateCustomerSchema.parse(req.body);
    return customers.updateCustomer(id, body);
  });

  app.post('/backoffice/customers/:id/archive', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    return customers.archiveCustomer(id);
  });

  app.post('/backoffice/customers/:id/unarchive', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    return customers.unarchiveCustomer(id);
  });

  // ─── Billing ────────────────────────────────────────────────────────────
  app.get('/backoffice/billing', guard, async (req) => {
    const query = listBillingQuery.parse(req.query);
    return customers.listBilling(query);
  });

  app.post('/backoffice/billing', guard, async (req, reply) => {
    const body = createBillingSchema.parse(req.body);
    const created = await customers.createBilling(body);
    return reply.status(201).send(created);
  });

  // ─── Usage ──────────────────────────────────────────────────────────────
  app.get('/backoffice/usage', guard, async (req) => {
    const query = listUsageQuery.parse(req.query);
    return customers.listUsage(query);
  });

  app.post('/backoffice/usage', guard, async (req, reply) => {
    const body = createUsageSchema.parse(req.body);
    const created = await customers.createUsage(body);
    return reply.status(201).send(created);
  });
}
