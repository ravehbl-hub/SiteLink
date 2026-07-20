/**
 * SiteLink back end — companies module Zod schemas (System-Admin, ADMIN-only).
 * The create/update input contracts live in @sitelink/shared (createCompanySchema /
 * updateCompanySchema); this file holds only the route-local param/query schemas.
 */
import { z } from 'zod';
import { PaginationQuery } from '../../lib/pagination.js';

/** GET /companies query — pagination + optional archived inclusion. */
export const listCompaniesQuerySchema = PaginationQuery.extend({
  includeArchived: z.coerce.boolean().optional(),
});

export const idParam = z.object({ id: z.string().min(1) });
