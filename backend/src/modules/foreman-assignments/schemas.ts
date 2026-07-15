/**
 * SiteLink back end — foreman-assignments module Zod schemas (Foreman multi-site).
 *
 * The create/assign body is the shared wire contract
 * (createForemanSiteAssignmentSchema). The list query filters by foremanId. Unassign
 * uses the same (foremanId, siteId) pair, supplied on the query string for the DELETE.
 */
import { z } from 'zod';

/** GET /foreman-assignments?foremanId= — list a foreman's ACTIVE assignments. */
export const listForemanAssignmentsQuery = z.object({
  foremanId: z.string().min(1),
});

/** DELETE /foreman-assignments — unassign a (foremanId, siteId) pair. */
export const unassignForemanQuery = z.object({
  foremanId: z.string().min(1),
  siteId: z.string().min(1),
});
