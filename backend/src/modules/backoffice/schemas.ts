/**
 * SiteLink back end — Back Office (SaaS business layer) Zod schemas.
 * ADMIN-only. Wire input contracts (create/update) live in @sitelink/shared;
 * these are the module-local list-query + path-param edges.
 */
import { z } from 'zod';

export const idParam = z.object({ id: z.string().min(1) });

export const listCustomersQuery = z.object({
  includeArchived: z.coerce.boolean().default(false),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const listBillingQuery = z.object({
  customerId: z.string().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const listUsageQuery = z.object({
  customerId: z.string().min(1).optional(),
  metric: z.string().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
