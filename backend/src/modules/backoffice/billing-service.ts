/**
 * SiteLink back end — Back Office SaaS billing/usage service (PRD §10 FR-BO).
 * ADMIN-only. List/create for Billing & Usage, keyed by the tenant Company (the
 * former standalone `Customer` model was MERGED into Company — Option C). The
 * company lifecycle CRUD lives in modules/companies; this module owns the SaaS
 * billing/usage ledgers only.
 */
import type { z } from 'zod';
import type {
  Billing,
  CreateBillingInput,
  CreateUsageInput,
  Paginated,
  Usage,
} from '@sitelink/shared';
import { prisma } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { mapBilling, mapUsage } from '../../lib/mappers.js';
import { paginate } from '../../lib/pagination.js';
import type { listBillingQuery, listUsageQuery } from './schemas.js';

type ListBillingQuery = z.infer<typeof listBillingQuery>;
type ListUsageQuery = z.infer<typeof listUsageQuery>;

export class BackOfficeBillingService {
  // ─── Billing ──────────────────────────────────────────────────────────────

  async listBilling(query: ListBillingQuery): Promise<Paginated<Billing>> {
    const where = query.companyId ? { companyId: query.companyId } : {};
    const skip = (query.page - 1) * query.pageSize;
    const [rows, total] = await Promise.all([
      prisma.billing.findMany({
        where,
        skip,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.billing.count({ where }),
    ]);
    return paginate(rows.map(mapBilling), total, {
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  async createBilling(input: CreateBillingInput): Promise<Billing> {
    await this.ensureCompany(input.companyId);
    const row = await prisma.billing.create({
      data: {
        companyId: input.companyId,
        status: input.status,
        plan: input.plan,
        amount: input.amount,
        currency: input.currency,
        periodStart: new Date(input.periodStart),
        periodEnd: new Date(input.periodEnd),
      },
    });
    return mapBilling(row);
  }

  // ─── Usage ────────────────────────────────────────────────────────────────

  async listUsage(query: ListUsageQuery): Promise<Paginated<Usage>> {
    const where = {
      ...(query.companyId ? { companyId: query.companyId } : {}),
      ...(query.metric ? { metric: query.metric } : {}),
    };
    const skip = (query.page - 1) * query.pageSize;
    const [rows, total] = await Promise.all([
      prisma.usage.findMany({
        where,
        skip,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.usage.count({ where }),
    ]);
    return paginate(rows.map(mapUsage), total, {
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  async createUsage(input: CreateUsageInput): Promise<Usage> {
    await this.ensureCompany(input.companyId);
    const row = await prisma.usage.create({
      data: {
        companyId: input.companyId,
        metric: input.metric,
        value: input.value,
        periodStart: new Date(input.periodStart),
        periodEnd: new Date(input.periodEnd),
      },
    });
    return mapUsage(row);
  }

  private async ensureCompany(id: string): Promise<void> {
    const exists = await prisma.company.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw AppError.notFound('Company not found');
  }
}
