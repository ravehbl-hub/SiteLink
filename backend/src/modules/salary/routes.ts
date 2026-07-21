/**
 * SiteLink back end — salary routes (FR-MGR-SRE). Manager/Admin-gated.
 *   POST /salary/calculate       compute pay via the SalaryRuleEngine (mode resolved
 *                                server-side from stored config, never the request).
 *   POST /salary/calculate-all   batch run for ALL active workers in the caller's
 *                                company (manager table; MANAGER_ROLES only).
 */
import type { FastifyInstance } from 'fastify';
import { Role } from '@sitelink/shared';
import { MANAGER_ROLES } from '../../plugins/auth.js';
import { requireWorkerId } from '../../lib/scope.js';
import { SalaryService } from './service.js';
import { calculateAllSalarySchema, calculateSalarySchema } from './schemas.js';

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

  // BATCH: all active workers in the caller's company. MANAGER_ROLES ONLY — a WORKER
  // may never run an all-workers report (no Role.WORKER in this guard, unlike above).
  const batchGuard = {
    preHandler: [app.authenticate, app.requireRole(...MANAGER_ROLES)],
  };
  app.post('/salary/calculate-all', batchGuard, async (req) => {
    const body = calculateAllSalarySchema.parse(req.body);
    return service.calculateAll(body, req.appUser!);
  });
}
