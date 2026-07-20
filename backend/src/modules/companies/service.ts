/**
 * SiteLink back end — System-Admin Company service (multi-tenancy Phase 1).
 *
 * ADMIN-only. CRUD + soft-archive for the tenant Company model (the app's primary
 * security boundary). Creating a MANAGER INTO a company is NOT here — that is the
 * users create path with an ADMIN supplying companyId (modules/users). This module
 * owns the company lifecycle only.
 *
 * The 1:1 (at-most-one) Company↔Customer link is enforced here up-front (the DB has
 * a @unique on Company.customerId; we pre-check to return a friendly CONFLICT rather
 * than a raw unique-violation). A company is retired by SOFT-ARCHIVE, never deleted
 * (deleting would orphan its users — User.companyId is onDelete: Restrict).
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

  /** Verify a billing Customer exists and is free (not already linked 1:1). */
  private async assertCustomerLinkable(customerId: string, exceptCompanyId?: string): Promise<void> {
    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw AppError.validation('Linked customer does not exist');
    const existing = await prisma.company.findUnique({
      where: { customerId },
      select: { id: true },
    });
    if (existing && existing.id !== exceptCompanyId) {
      // @unique guards this at the DB too; pre-check for a friendly 409.
      throw AppError.conflict('That customer is already linked to another company');
    }
  }

  async create(input: CreateCompanyInput): Promise<Company> {
    if (input.customerId) {
      await this.assertCustomerLinkable(input.customerId);
    }
    const row = await prisma.company.create({
      data: {
        name: input.name,
        customerId: input.customerId ?? null,
      },
    });
    return mapCompany(row);
  }

  async update(id: string, input: UpdateCompanyInput): Promise<Company> {
    await this.get(id); // 404 if missing.
    if (input.customerId) {
      await this.assertCustomerLinkable(input.customerId, id);
    }
    const row = await prisma.company.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.customerId !== undefined ? { customerId: input.customerId } : {}),
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
