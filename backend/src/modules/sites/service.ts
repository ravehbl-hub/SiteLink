/**
 * SiteLink back end — sites service (FR-MGR-SITE). CRUD + archive (soft-delete).
 */
import type { z } from 'zod';
import { SiteStatus, type Paginated, type Site } from '@sitelink/shared';
import { prisma } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { mapSite } from '../../lib/mappers.js';
import { paginate } from '../../lib/pagination.js';
import type { createSiteSchema, listSitesQuery, updateSiteSchema } from './schemas.js';

type CreateInput = z.infer<typeof createSiteSchema>;
type UpdateInput = z.infer<typeof updateSiteSchema>;
type ListQuery = z.infer<typeof listSitesQuery>;

export class SitesService {
  async list(query: ListQuery): Promise<Paginated<Site>> {
    const where = query.includeArchived ? {} : { isArchived: false };
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

  async get(id: string): Promise<Site> {
    const row = await prisma.site.findUnique({ where: { id } });
    if (!row) throw AppError.notFound('Site not found');
    return mapSite(row);
  }

  async create(input: CreateInput): Promise<Site> {
    const row = await prisma.site.create({
      data: {
        name: input.name,
        code: input.code ?? null,
        address: input.address ?? null,
        startedAt: input.startedAt ? new Date(input.startedAt) : null,
      },
    });
    return mapSite(row);
  }

  async update(id: string, input: UpdateInput): Promise<Site> {
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
  async archive(id: string): Promise<Site> {
    await this.ensureExists(id);
    const row = await prisma.site.update({
      where: { id },
      data: { isArchived: true, archivedAt: new Date(), status: SiteStatus.ARCHIVED },
    });
    return mapSite(row);
  }

  async remove(id: string): Promise<void> {
    await this.ensureExists(id);
    await prisma.site.delete({ where: { id } });
  }

  private async ensureExists(id: string): Promise<void> {
    const exists = await prisma.site.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw AppError.notFound('Site not found');
  }
}
