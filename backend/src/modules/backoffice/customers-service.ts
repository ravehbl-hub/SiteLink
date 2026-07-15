/**
 * SiteLink back end — Back Office SaaS business layer service (PRD §10 FR-BO).
 * ADMIN-only. CRUD + archive for Customers, plus create/list for Billing & Usage.
 * A "Customer" is SiteLink's own SaaS customer (the operating business's tenant).
 */
import type { z } from 'zod';
import type {
  Billing,
  CreateBillingInput,
  CreateCustomerInput,
  CreateUsageInput,
  Customer,
  Paginated,
  UpdateCustomerInput,
  Usage,
} from '@sitelink/shared';
import { prisma } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { mapBilling, mapCustomer, mapUsage } from '../../lib/mappers.js';
import { paginate } from '../../lib/pagination.js';
import type { listBillingQuery, listCustomersQuery, listUsageQuery } from './schemas.js';

type ListCustomersQuery = z.infer<typeof listCustomersQuery>;
type ListBillingQuery = z.infer<typeof listBillingQuery>;
type ListUsageQuery = z.infer<typeof listUsageQuery>;

export class CustomersService {
  // ─── Customers ────────────────────────────────────────────────────────────

  async listCustomers(query: ListCustomersQuery): Promise<Paginated<Customer>> {
    const where = query.includeArchived ? {} : { isArchived: false };
    const skip = (query.page - 1) * query.pageSize;
    const [rows, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        skip,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.customer.count({ where }),
    ]);
    return paginate(rows.map(mapCustomer), total, {
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  async getCustomer(id: string): Promise<Customer> {
    const row = await prisma.customer.findUnique({ where: { id } });
    if (!row) throw AppError.notFound('Customer not found');
    return mapCustomer(row);
  }

  async createCustomer(input: CreateCustomerInput): Promise<Customer> {
    const row = await prisma.customer.create({
      data: {
        name: input.name,
        contactEmail: input.contactEmail ?? null,
        contactPhone: input.contactPhone ?? null,
        ...(input.registeredAt ? { registeredAt: new Date(input.registeredAt) } : {}),
      },
    });
    return mapCustomer(row);
  }

  async updateCustomer(id: string, input: UpdateCustomerInput): Promise<Customer> {
    await this.ensureCustomer(id);
    const row = await prisma.customer.update({
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
    return mapCustomer(row);
  }

  /** Archive = soft-delete (mirrors sites): set isArchived + archivedAt. */
  async archiveCustomer(id: string): Promise<Customer> {
    await this.ensureCustomer(id);
    const row = await prisma.customer.update({
      where: { id },
      data: { isArchived: true, archivedAt: new Date() },
    });
    return mapCustomer(row);
  }

  async unarchiveCustomer(id: string): Promise<Customer> {
    await this.ensureCustomer(id);
    const row = await prisma.customer.update({
      where: { id },
      data: { isArchived: false, archivedAt: null },
    });
    return mapCustomer(row);
  }

  // ─── Billing ──────────────────────────────────────────────────────────────

  async listBilling(query: ListBillingQuery): Promise<Paginated<Billing>> {
    const where = query.customerId ? { customerId: query.customerId } : {};
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
    await this.ensureCustomer(input.customerId);
    const row = await prisma.billing.create({
      data: {
        customerId: input.customerId,
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
      ...(query.customerId ? { customerId: query.customerId } : {}),
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
    await this.ensureCustomer(input.customerId);
    const row = await prisma.usage.create({
      data: {
        customerId: input.customerId,
        metric: input.metric,
        value: input.value,
        periodStart: new Date(input.periodStart),
        periodEnd: new Date(input.periodEnd),
      },
    });
    return mapUsage(row);
  }

  private async ensureCustomer(id: string): Promise<void> {
    const exists = await prisma.customer.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw AppError.notFound('Customer not found');
  }
}
