/**
 * SiteLink back end — dashboard module Zod schemas (FR-MGR-DASH).
 *
 * Filter: optional siteId (all-sites when omitted, FR-MGR-DASH-1) + a date range.
 * When from/to are omitted we default to a sensible window (the current month to
 * date) so the endpoint always returns a well-formed rollup.
 */
import { z } from 'zod';

export const dashboardQuery = z.object({
  siteId: z.string().optional(),
  // MULTI-TENANCY (P2): ADMIN read-narrow to one company; IGNORED for a non-admin.
  companyId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  /** Revenue is a MANUAL per-site input (PRD A-3); passed on the query for P&L. */
  revenue: z.coerce.number().nonnegative().default(0),
  currency: z.string().default('ILS'),
});

export type DashboardQuery = z.infer<typeof dashboardQuery>;
