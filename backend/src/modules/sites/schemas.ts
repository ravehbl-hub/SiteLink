/**
 * SiteLink back end — sites module Zod schemas (FR-MGR-SITE).
 */
import { z } from 'zod';
import { SiteStatus } from '@sitelink/shared';

export const createSiteSchema = z.object({
  name: z.string().min(1),
  code: z.string().nullish(),
  address: z.string().nullish(),
  startedAt: z.string().datetime().nullish(),
});

export const updateSiteSchema = z.object({
  name: z.string().min(1).optional(),
  code: z.string().nullish(),
  address: z.string().nullish(),
  status: z.nativeEnum(SiteStatus).optional(),
  startedAt: z.string().datetime().nullish(),
});

export const listSitesQuery = z.object({
  includeArchived: z.preprocess((v) => (typeof v === 'string' ? v === 'true' : v), z.boolean()).default(false),
  // MULTI-TENANCY (P2): ADMIN read-narrow to one company; IGNORED for a non-admin.
  companyId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const idParam = z.object({ id: z.string().min(1) });
