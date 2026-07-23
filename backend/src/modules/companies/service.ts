/**
 * SiteLink back end — System-Admin Company service (multi-tenancy).
 *
 * ADMIN-only. CRUD + soft-archive for the tenant Company model — the app's primary
 * security boundary AND billing subject (the former standalone `Customer` model was
 * MERGED into Company). Creating a MANAGER INTO a company is NOT here — that is the
 * users create path with an ADMIN supplying companyId (modules/users). This module
 * owns the company lifecycle only.
 *
 * A company is retired by SOFT-ARCHIVE, never deleted (deleting would orphan its
 * users — User.companyId is onDelete: Restrict). Company create/edit now accepts the
 * billing contact/lifecycle fields (contactEmail/contactPhone/registeredAt/leftAt)
 * directly; there is no separate Customer entity to link.
 */
import type { z } from 'zod';
import type {
  Company,
  CreateCompanyInput,
  Paginated,
  UpdateCompanyInput,
} from '@sitelink/shared';
import { prisma } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { mapCompany } from '../../lib/mappers.js';
import { paginate, toSkipTake } from '../../lib/pagination.js';
import type { listCompaniesQuerySchema } from './schemas.js';

type ListQuery = z.infer<typeof listCompaniesQuerySchema>;

export class CompaniesService {
  async list(query: ListQuery): Promise<Paginated<Company>> {
    const where = query.includeArchived ? {} : { isArchived: false };
    const { skip, take } = toSkipTake(query);
    const [rows, total] = await Promise.all([
      prisma.company.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      prisma.company.count({ where }),
    ]);
    return paginate(rows.map(mapCompany), total, query);
  }

  async get(id: string): Promise<Company> {
    const row = await prisma.company.findUnique({ where: { id } });
    if (!row) throw AppError.notFound('Company not found');
    return mapCompany(row);
  }

  async create(input: CreateCompanyInput): Promise<Company> {
    const row = await prisma.company.create({
      data: {
        name: input.name,
        contactEmail: input.contactEmail ?? null,
        contactPhone: input.contactPhone ?? null,
        ...(input.registeredAt ? { registeredAt: new Date(input.registeredAt) } : {}),
      },
    });
    return mapCompany(row);
  }

  async update(id: string, input: UpdateCompanyInput): Promise<Company> {
    await this.get(id); // 404 if missing.
    const row = await prisma.company.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.contactEmail !== undefined ? { contactEmail: input.contactEmail } : {}),
        ...(input.contactPhone !== undefined ? { contactPhone: input.contactPhone } : {}),
        ...(input.registeredAt !== undefined
          ? { registeredAt: new Date(input.registeredAt) }
          : {}),
        ...(input.leftAt !== undefined
          ? { leftAt: input.leftAt ? new Date(input.leftAt) : null }
          : {}),
      },
    });
    return mapCompany(row);
  }

  async archive(id: string): Promise<Company> {
    await this.get(id);
    const row = await prisma.company.update({
      where: { id },
      data: { isArchived: true, archivedAt: new Date() },
    });
    return mapCompany(row);
  }

  async unarchive(id: string): Promise<Company> {
    await this.get(id);
    const row = await prisma.company.update({
      where: { id },
      data: { isArchived: false, archivedAt: null },
    });
    return mapCompany(row);
  }
}
