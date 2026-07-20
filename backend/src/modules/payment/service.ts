/**
 * SiteLink back end — payment service (FR-MGR-PAY). Profession wage rates CRUD.
 *
 * MULTI-TENANCY (P2): ProfessionWageRate is PER-COMPANY (@@unique[companyId, profession,
 * siteId]). Every read is company-filtered; every create stamps the caller's OWN company
 * (server-derived); a cross-company rate is never visible/mutable (404). A worker only
 * ever resolves a rate in their own company (enforced in the salary service).
 */
import type { z } from 'zod';
import type { ProfessionWageRate } from '@sitelink/shared';
import { Role } from '@sitelink/shared';
import { prisma } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { mapWageRate } from '../../lib/mappers.js';
import {
  assertCompanyScopeMatch,
  companyWhere,
  DEFAULT_COMPANY_ID,
  effectiveCompanyScope,
  resolveCompanyScope,
  resolveStampCompanyId,
  type CompanyScope,
} from '../../lib/scope.js';
import type { AuthUser } from '../../plugins/types.js';
import type { createWageRateSchema, updateWageRateSchema } from './schemas.js';

type CreateInput = z.infer<typeof createWageRateSchema>;
type UpdateInput = z.infer<typeof updateWageRateSchema>;

export class PaymentService {
  private companyScope(caller?: AuthUser): CompanyScope {
    return caller ? resolveCompanyScope(caller) : { allCompanies: true };
  }

  async list(caller?: AuthUser, requestedCompanyId?: string): Promise<ProfessionWageRate[]> {
    const companyClause = caller
      ? companyWhere(effectiveCompanyScope(caller, requestedCompanyId))
      : {};
    const rows = await prisma.professionWageRate.findMany({
      where: companyClause,
      orderBy: [{ profession: 'asc' }, { siteId: 'asc' }],
    });
    return rows.map(mapWageRate);
  }

  async create(input: CreateInput, caller?: AuthUser): Promise<ProfessionWageRate> {
    // P2: stamp the caller's OWN company; dedupe PER-COMPANY (profession, siteId).
    const companyId = resolveStampCompanyId(
      caller ?? { role: Role.ADMIN, companyId: DEFAULT_COMPANY_ID },
    );
    const existing = await prisma.professionWageRate.findFirst({
      where: { companyId, profession: input.profession, siteId: input.siteId ?? null },
    });
    if (existing) {
      throw AppError.conflict('A wage rate already exists for this profession/site');
    }
    const row = await prisma.professionWageRate.create({
      data: {
        companyId,
        profession: input.profession,
        wage: input.wage,
        rateType: input.rateType,
        calcMode: input.calcMode,
        currency: input.currency,
        siteId: input.siteId ?? null,
      },
    });
    return mapWageRate(row);
  }

  async update(id: string, input: UpdateInput, caller?: AuthUser): Promise<ProfessionWageRate> {
    const current = await prisma.professionWageRate.findUnique({ where: { id } });
    // Cross-company (or missing) → 404, no existence leak.
    assertCompanyScopeMatch(this.companyScope(caller), current?.companyId);
    if (!current) throw AppError.notFound('Wage rate not found');
    const row = await prisma.professionWageRate.update({
      where: { id },
      data: {
        ...(input.wage !== undefined ? { wage: input.wage } : {}),
        ...(input.rateType !== undefined ? { rateType: input.rateType } : {}),
        ...(input.calcMode !== undefined ? { calcMode: input.calcMode } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
      },
    });
    return mapWageRate(row);
  }

  async remove(id: string, caller?: AuthUser): Promise<void> {
    const current = await prisma.professionWageRate.findUnique({
      where: { id },
      select: { id: true, companyId: true },
    });
    assertCompanyScopeMatch(this.companyScope(caller), current?.companyId);
    if (!current) throw AppError.notFound('Wage rate not found');
    await prisma.professionWageRate.delete({ where: { id } });
  }
}
