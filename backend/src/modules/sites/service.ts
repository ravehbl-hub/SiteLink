/**
 * SiteLink back end — sites service (FR-MGR-SITE). CRUD + archive (soft-delete).
 */
import type { z } from 'zod';
import { SiteStatus, type Paginated, type Site } from '@sitelink/shared';
import { prisma } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { mapSite } from '../../lib/mappers.js';
import { paginate } from '../../lib/pagination.js';
import {
  assertCompanyScopeMatch,
  companyWhere,
  DEFAULT_COMPANY_ID,
  effectiveCompanyScope,
  resolveCompanyScope,
  resolveStampCompanyId,
  type CompanyScope,
} from '../../lib/scope.js';
import { Role } from '@sitelink/shared';
import type { AuthUser } from '../../plugins/types.js';
import type { createSiteSchema, listSitesQuery, updateSiteSchema } from './schemas.js';

type CreateInput = z.infer<typeof createSiteSchema>;
type UpdateInput = z.infer<typeof updateSiteSchema>;
type ListQuery = z.infer<typeof listSitesQuery>;

export class SitesService {
  private companyScope(caller?: AuthUser): CompanyScope {
    return caller ? resolveCompanyScope(caller) : { allCompanies: true };
  }

  /** Load a site's company + assert it is in the caller's scope (404 otherwise). */
  private async assertSiteCompany(id: string, caller?: AuthUser): Promise<void> {
    if (!caller) return;
    const row = await prisma.site.findUnique({ where: { id }, select: { companyId: true } });
    assertCompanyScopeMatch(this.companyScope(caller), row?.companyId);
  }

  async list(query: ListQuery, caller?: AuthUser): Promise<Paginated<Site>> {
    // MULTI-TENANCY (P2): company filter ANDs with the archived view. Non-admin pinned
    // to own company; ADMIN unscoped (+ ?companyId read-narrow).
    const companyClause = caller
      ? companyWhere(effectiveCompanyScope(caller, query.companyId))
      : {};
    const where = {
      ...companyClause,
      ...(query.includeArchived ? {} : { isArchived: false }),
    };
    const skip = (query.page - 1) * query.pageSize;
    const [rows, total] = await Promise.all([
      prisma.site.findMany({
        where,
        skip,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.site.count({ where }),
    ]);
    return paginate(rows.map(mapSite), total, {
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  async get(id: string, caller?: AuthUser): Promise<Site> {
    const row = await prisma.site.findUnique({ where: { id } });
    // Cross-company (or missing) → 404, no existence leak.
    assertCompanyScopeMatch(this.companyScope(caller), row?.companyId);
    if (!row) throw AppError.notFound('Site not found');
    return mapSite(row);
  }

  async create(input: CreateInput, caller?: AuthUser): Promise<Site> {
    // P2: stamp the caller's OWN company (server-derived); client companyId never widens.
    const companyId = resolveStampCompanyId(
      caller ?? { role: Role.ADMIN, companyId: DEFAULT_COMPANY_ID },
    );
    const row = await prisma.site.create({
      data: {
        companyId,
        name: input.name,
        code: input.code ?? null,
        address: input.address ?? null,
        startedAt: input.startedAt ? new Date(input.startedAt) : null,
      },
    });
    return mapSite(row);
  }

  async update(id: string, input: UpdateInput, caller?: AuthUser): Promise<Site> {
    await this.assertSiteCompany(id, caller);
    await this.ensureExists(id);
    const row = await prisma.site.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.startedAt !== undefined
          ? { startedAt: input.startedAt ? new Date(input.startedAt) : null }
          : {}),
      },
    });
    return mapSite(row);
  }

  /** Archive = soft-delete: set isArchived + status ARCHIVED (FR-MGR-SITE-1/3). */
  async archive(id: string, caller?: AuthUser): Promise<Site> {
    await this.assertSiteCompany(id, caller);
    await this.ensureExists(id);
    const row = await prisma.site.update({
      where: { id },
      data: { isArchived: true, archivedAt: new Date(), status: SiteStatus.ARCHIVED },
    });
    return mapSite(row);
  }

  async remove(id: string, caller?: AuthUser): Promise<void> {
    await this.assertSiteCompany(id, caller);
    await this.ensureExists(id);
    await prisma.site.delete({ where: { id } });
  }

  private async ensureExists(id: string): Promise<void> {
    const exists = await prisma.site.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw AppError.notFound('Site not found');
  }
}
