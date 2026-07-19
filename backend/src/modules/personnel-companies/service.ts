/**
 * SiteLink back end — personnel-companies service.
 *
 * ADMIN/MANAGER CRUD for PersonnelCompany (staffing companies). ORG-WIDE and NOT
 * site-scoped: this entity has no site relation, so there is NO lib/scope usage here
 * — every caller that clears the MANAGER role gate sees/manages the whole list.
 *
 * `name` is unique (schema @unique). Duplicate names surface as a friendly 409 via a
 * pre-check plus a P2002 backstop (a race between the pre-check and the write still
 * maps to a clean CONFLICT, never a raw Prisma error).
 *
 * REMOVE is a HARD delete (prisma.personnelCompany.delete). The Worker.personnelCompanyId
 * FK is declared `onDelete: SetNull`, so any workers linked to a deleted company are
 * automatically UN-LINKED by the database (their personnelCompanyId becomes NULL) — no
 * orphan rows, no FK crash, and the worker itself is NOT deleted. Those workers retain
 * their legacy free-text `personnelCompany` mirror value, which is fine (that column is
 * an independent free-text field, not the FK). Deletion is never blocked on linked workers.
 */
import type { Paginated, PersonnelCompany } from '@sitelink/shared';
import type { z } from 'zod';
import type { PersonnelCompany as PPersonnelCompany } from '../../generated/prisma/client.js';
import { prisma } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { toISORequired } from '../../lib/dates.js';
import { paginate } from '../../lib/pagination.js';
import type {
  createPersonnelCompanySchema,
  listPersonnelCompaniesQuery,
  updatePersonnelCompanySchema,
} from './schemas.js';

type CreateInput = z.infer<typeof createPersonnelCompanySchema>;
type UpdateInput = z.infer<typeof updatePersonnelCompanySchema>;
type ListQuery = z.infer<typeof listPersonnelCompaniesQuery>;

/** Prisma row → wire DTO (consistent with lib/mappers.ts style). */
function mapPersonnelCompany(c: PPersonnelCompany): PersonnelCompany {
  return {
    id: c.id,
    name: c.name,
    contactName: c.contactName,
    phone: c.phone,
    email: c.email,
    isArchived: c.isArchived,
    createdAt: toISORequired(c.createdAt),
    updatedAt: toISORequired(c.updatedAt),
  };
}

/** True when an error is a Prisma unique-constraint violation (P2002). */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'P2002'
  );
}

export class PersonnelCompaniesService {
  /**
   * List staffing companies. Org-wide (no site scope). The archived toggle is a
   * VIEW switch (mirrors the workers Active/Archived view): `includeArchived` shows
   * ONLY archived companies; otherwise ONLY active ones. Name asc so the picker reads
   * alphabetically. (The worker-form picker never passes the flag → active only.)
   */
  async list(query: ListQuery): Promise<Paginated<PersonnelCompany>> {
    const where = query.includeArchived ? { isArchived: true } : { isArchived: false };
    const skip = (query.page - 1) * query.pageSize;
    const [rows, total] = await Promise.all([
      prisma.personnelCompany.findMany({
        where,
        skip,
        take: query.pageSize,
        orderBy: { name: 'asc' },
      }),
      prisma.personnelCompany.count({ where }),
    ]);
    return paginate(rows.map(mapPersonnelCompany), total, {
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  async get(id: string): Promise<PersonnelCompany> {
    const row = await prisma.personnelCompany.findUnique({ where: { id } });
    if (!row) throw AppError.notFound('Personnel company not found');
    return mapPersonnelCompany(row);
  }

  async create(input: CreateInput): Promise<PersonnelCompany> {
    // Friendly pre-check on the unique name (P2002 backstop below covers the race).
    const clash = await prisma.personnelCompany.findUnique({
      where: { name: input.name },
      select: { id: true },
    });
    if (clash) {
      throw AppError.conflict('A personnel company with this name already exists');
    }
    try {
      const row = await prisma.personnelCompany.create({
        data: {
          name: input.name,
          contactName: input.contactName ?? null,
          phone: input.phone ?? null,
          email: input.email ?? null,
        },
      });
      return mapPersonnelCompany(row);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw AppError.conflict('A personnel company with this name already exists');
      }
      throw err;
    }
  }

  async update(id: string, input: UpdateInput): Promise<PersonnelCompany> {
    await this.ensureExists(id);
    // Guard the unique name up front when the caller is changing it → friendly 409.
    if (input.name !== undefined) {
      const clash = await prisma.personnelCompany.findUnique({
        where: { name: input.name },
        select: { id: true },
      });
      if (clash && clash.id !== id) {
        throw AppError.conflict('A personnel company with this name already exists');
      }
    }
    try {
      const row = await prisma.personnelCompany.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.contactName !== undefined ? { contactName: input.contactName } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.email !== undefined ? { email: input.email } : {}),
        },
      });
      return mapPersonnelCompany(row);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw AppError.conflict('A personnel company with this name already exists');
      }
      throw err;
    }
  }

  async archive(id: string): Promise<PersonnelCompany> {
    await this.ensureExists(id);
    const row = await prisma.personnelCompany.update({
      where: { id },
      data: { isArchived: true },
    });
    return mapPersonnelCompany(row);
  }

  async unarchive(id: string): Promise<PersonnelCompany> {
    await this.ensureExists(id);
    const row = await prisma.personnelCompany.update({
      where: { id },
      data: { isArchived: false },
    });
    return mapPersonnelCompany(row);
  }

  /**
   * HARD delete a personnel company (FR: manager removes a company from the list).
   * 404 if it does not exist. Linked workers are automatically un-linked by the FK
   * (Worker.personnelCompanyId onDelete:SetNull) — they are NOT deleted and keep their
   * free-text `personnelCompany` mirror. Deletion is never blocked on linked workers.
   */
  async remove(id: string): Promise<void> {
    await this.ensureExists(id);
    await prisma.personnelCompany.delete({ where: { id } });
  }

  private async ensureExists(id: string): Promise<void> {
    const exists = await prisma.personnelCompany.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw AppError.notFound('Personnel company not found');
  }
}
