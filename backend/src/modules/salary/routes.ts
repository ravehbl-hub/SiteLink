/**
 * SiteLink back end — salary routes (FR-MGR-SRE). Manager/Admin-gated.
 *   POST /salary/calculate   compute pay via the SalaryRuleEngine (mode resolved
 *                            server-side from stored config, never the request).
 */
import type { FastifyInstance } from 'fastify';
import { Role } from '@sitelink/shared';
import { MANAGER_ROLES } from '../../plugins/auth.js';
import { requireWorkerId } from '../../lib/scope.js';
import { SalaryService } from './service.js';
import { calculateSalarySchema } from './schemas.js';

export async function salaryRoutes(app: FastifyInstance): Promise<void> {
  const service = new SalaryService();
  // ADMIN/MANAGER compute any worker's pay. WORKER may compute their OWN payslip
  // only — the workerId is FORCED to the caller's resolved Worker (client-supplied
  // workerId is ignored), so a WORKER can never compute another worker's salary.
  const guard = {
    preHandler: [app.authenticate, app.requireRole(...MANAGER_ROLES, Role.WORKER)],
  };

  app.post('/salary/calculate', guard, async (req) => {
    const body = calculateSalarySchema.parse(req.body);
    if (req.appUser!.role === Role.WORKER) {
      // Fail-closed: 403 if the caller has no linked Worker row.
      const selfWorkerId = await requireWorkerId(req.appUser!);
      return service.calculate(
        { ...body, workerId: selfWorkerId, siteId: undefined },
        req.appUser!,
      );
    }
    return service.calculate(body, req.appUser!);
  });
}
