/**
 * SiteLink back end — payment routes (FR-MGR-PAY). Manager/Admin-gated.
 *   GET    /wage-rates        list
 *   POST   /wage-rates        add
 *   PATCH  /wage-rates/:id     modify
 *   DELETE /wage-rates/:id     remove
 */
import type { FastifyInstance } from 'fastify';
import { MANAGER_ROLES } from '../../plugins/auth.js';
import { PaymentService } from './service.js';
import { createWageRateSchema, idParam, updateWageRateSchema } from './schemas.js';

export async function paymentRoutes(app: FastifyInstance): Promise<void> {
  const service = new PaymentService();
  const guard = { preHandler: [app.authenticate, app.requireRole(...MANAGER_ROLES)] };

  app.get('/wage-rates', guard, async (req) => {
    // ADMIN read-narrow via ?companyId; IGNORED for a non-admin (pinned to own company).
    const companyId = (req.query as { companyId?: string } | undefined)?.companyId;
    return service.list(req.appUser!, companyId);
  });

  app.post('/wage-rates', guard, async (req, reply) => {
    const body = createWageRateSchema.parse(req.body);
    const rate = await service.create(body, req.appUser!);
    return reply.status(201).send(rate);
  });

  app.patch('/wage-rates/:id', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = updateWageRateSchema.parse(req.body);
    return service.update(id, body, req.appUser!);
  });

  app.delete('/wage-rates/:id', guard, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    await service.remove(id, req.appUser!);
    return reply.status(204).send();
  });
}
