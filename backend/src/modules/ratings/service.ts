/**
 * SiteLink back end — Foreman worker-ratings service (FR-FOR-5, Phase 05 Stage B).
 *
 * A FOREMAN authors a 1..5 performance rating for a worker on a date. Security:
 *   - foremanId is ALWAYS the authenticated caller (req.appUser.id) — never from the
 *     client body (createWorkerRatingSchema deliberately omits it).
 *   - a FOREMAN may only rate / read ratings for a worker on THEIR site(s); this is
 *     enforced via assertWorkerInScope before any read or write. ADMIN/MANAGER are
 *     unscoped (they may rate/read any worker).
 */
import type { CreateWorkerRatingInput, WorkerRating } from '@sitelink/shared';
import { prisma } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { mapRating } from '../../lib/mappers.js';
import {
  assertCompanyScopeMatch,
  assertWorkerInScope,
  resolveCompanyScope,
} from '../../lib/scope.js';
import type { AuthUser } from '../../plugins/types.js';

export class RatingsService {
  /**
   * MULTI-TENANCY (P2, DERIVED MODEL): WorkerRating has no companyId column — its tenant
   * derives from the parent Worker. A rating's worker MUST be in the caller's company;
   * a cross-company worker → 404 (no existence leak) BEFORE the site-scope check.
   */
  private async assertWorkerCompany(workerId: string, caller: AuthUser): Promise<void> {
    const w = await prisma.worker.findUnique({
      where: { id: workerId },
      select: { companyId: true },
    });
    assertCompanyScopeMatch(resolveCompanyScope(caller), w?.companyId);
  }
  /**
   * List a worker's ratings (most recent first). The path `workerId` is validated
   * against the caller's scope: a FOREMAN off their site → 403, never another site's
   * ratings.
   */
  async listForWorker(workerId: string, caller: AuthUser): Promise<WorkerRating[]> {
    await this.assertWorkerCompany(workerId, caller);
    await this.ensureWorker(workerId);
    await assertWorkerInScope(caller, workerId);
    const rows = await prisma.workerRating.findMany({
      where: { workerId },
      orderBy: { date: 'desc' },
    });
    return rows.map(mapRating);
  }

  /**
   * Create a rating. `input.workerId` is the target worker; foremanId is forced to
   * the caller. A FOREMAN may only rate a worker on their site (403 otherwise).
   */
  async create(input: CreateWorkerRatingInput, caller: AuthUser): Promise<WorkerRating> {
    await this.assertWorkerCompany(input.workerId, caller);
    await this.ensureWorker(input.workerId);
    await assertWorkerInScope(caller, input.workerId);
    const row = await prisma.workerRating.create({
      data: {
        workerId: input.workerId,
        // SECURITY: server-derived author, never client-supplied.
        foremanId: caller.id,
        date: new Date(input.date),
        score: input.score,
        notes: input.notes ?? null,
      },
    });
    return mapRating(row);
  }

  private async ensureWorker(workerId: string): Promise<void> {
    const worker = await prisma.worker.findUnique({
      where: { id: workerId },
      select: { id: true },
    });
    if (!worker) throw AppError.notFound('Worker not found');
  }
}
