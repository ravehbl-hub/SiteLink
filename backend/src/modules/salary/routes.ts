/**
 * SiteLink back end — salary routes (FR-MGR-SRE). Manager/Admin-gated.
 *   POST /salary/calculate   compute pay via the SalaryRuleEngine (mode resolved
 *                            server-side from stored config, never the request).
 */
import type { FastifyInstance } from 'fastify';
import { MANAGER_ROLES } from '../../plugins/auth.js';
import { SalaryService } from './service.js';
import { calculateSalarySchema } from './schemas.js';

export async function salaryRoutes(app: FastifyInstance): Promise<void> {
  const service = new SalaryService();
  const guard = { preHandler: [app.authenticate, app.requireRole(...MANAGER_ROLES)] };

  app.post('/salary/calculate', guard, async (req) => {
    const body = calculateSalarySchema.parse(req.body);
    return service.calculate(body);
  });
}
