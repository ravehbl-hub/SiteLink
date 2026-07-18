/**
 * SiteLink back end — personnel-companies module Zod schemas.
 *
 * The create/update/list-query contracts live in @sitelink/shared so both ends bind
 * to one wire contract (matching foreman-site-assignment). We re-export them here for
 * local ergonomics and add the route-local :id param guard.
 */
import { z } from 'zod';

export {
  createPersonnelCompanySchema,
  updatePersonnelCompanySchema,
  listPersonnelCompaniesQuery,
} from '@sitelink/shared';

export const idParam = z.object({ id: z.string().min(1) });
