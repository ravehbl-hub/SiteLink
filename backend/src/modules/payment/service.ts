/**
 * SiteLink back end — payment service (FR-MGR-PAY). Profession wage rates CRUD.
 */
import type { z } from 'zod';
import type { ProfessionWageRate } from '@sitelink/shared';
import { prisma } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { mapWageRate } from '../../lib/mappers.js';
import type { createWageRateSchema, updateWageRateSchema } from './schemas.js';

type CreateInput = z.infer<typeof createWageRateSchema>;
type UpdateInput = z.infer<typeof updateWageRateSchema>;

export class PaymentService {
  async list(): Promise<ProfessionWageRate[]> {
    const rows = await prisma.professionWageRate.findMany({
      orderBy: [{ profession: 'asc' }, { siteId: 'asc' }],
    });
    return rows.map(mapWageRate);
  }

  async create(input: CreateInput): Promise<ProfessionWageRate> {
    // Unique per (profession, siteId).
    const existing = await prisma.professionWageRate.findFirst({
      where: { profession: input.profession, siteId: input.siteId ?? null },
    });
    if (existing) {
      throw AppError.conflict('A wage rate already exists for this profession/site');
    }
    const row = await prisma.professionWageRate.create({
      data: {
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

  async update(id: string, input: UpdateInput): Promise<ProfessionWageRate> {
    const current = await prisma.professionWageRate.findUnique({ where: { id } });
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

  async remove(id: string): Promise<void> {
    const current = await prisma.professionWageRate.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!current) throw AppError.notFound('Wage rate not found');
    await prisma.professionWageRate.delete({ where: { id } });
  }
}
