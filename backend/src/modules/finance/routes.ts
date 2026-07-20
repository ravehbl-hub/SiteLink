/**
 * SiteLink back end — finance routes (FR-MGR-LOAN/ADV/PNL). Manager/Admin-gated.
 *   GET/POST /loans          PATCH/DELETE /loans/:id
 *   GET/POST /advances       PATCH/DELETE /advances/:id
 *   GET      /profit-loss    (?siteId,from,to,revenue) — computed on demand
 */
import type { FastifyInstance } from 'fastify';
import { MANAGER_ROLES, READ_ROLES } from '../../plugins/auth.js';
import { effectiveCompanyScope } from '../../lib/scope.js';
import { FinanceService } from './service.js';
import {
  createAdvanceSchema,
  createLoanSchema,
  idParam,
  listByWorkerQuery,
  profitLossQuery,
  updateAdvanceSchema,
  updateLoanSchema,
} from './schemas.js';

export async function financeRoutes(app: FastifyInstance): Promise<void> {
  const service = new FinanceService();
  const guard = { preHandler: [app.authenticate, app.requireRole(...MANAGER_ROLES)] };
  // P&L is read-oriented; PARTNER may read it too.
  const readGuard = { preHandler: [app.authenticate, app.requireRole(...READ_ROLES)] };

  // ── Loans ──
  app.get('/loans', guard, async (req) => {
    const query = listByWorkerQuery.parse(req.query);
    return service.listLoans(query, req.appUser!);
  });
  app.post('/loans', guard, async (req, reply) => {
    const body = createLoanSchema.parse(req.body);
    return reply.status(201).send(await service.createLoan(body, req.appUser!));
  });
  app.patch('/loans/:id', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    return service.updateLoan(id, updateLoanSchema.parse(req.body), req.appUser!);
  });
  app.delete('/loans/:id', guard, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    await service.removeLoan(id, req.appUser!);
    return reply.status(204).send();
  });

  // ── Advances ──
  app.get('/advances', guard, async (req) => {
    const query = listByWorkerQuery.parse(req.query);
    return service.listAdvances(query, req.appUser!);
  });
  app.post('/advances', guard, async (req, reply) => {
    const body = createAdvanceSchema.parse(req.body);
    return reply.status(201).send(await service.createAdvance(body, req.appUser!));
  });
  app.patch('/advances/:id', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    return service.updateAdvance(id, updateAdvanceSchema.parse(req.body), req.appUser!);
  });
  app.delete('/advances/:id', guard, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    await service.removeAdvance(id, req.appUser!);
    return reply.status(204).send();
  });

  // ── Profit & Loss ──
  app.get('/profit-loss', readGuard, async (req) => {
    const query = profitLossQuery.parse(req.query);
    // MULTI-TENANCY (P2): non-admin pinned to own company; ADMIN unscoped (+ ?companyId
    // read-narrow). Every P&L aggregate is company-scoped in the service.
    const scope = effectiveCompanyScope(req.appUser!, query.companyId);
    return service.profitLoss(query, scope);
  });
}
