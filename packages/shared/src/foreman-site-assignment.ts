/**
 * @sitelink/shared — Foreman ⇄ Site assignment (multi-site Foreman scope).
 *
 * Security-boundary change: a FOREMAN was scoped to a SINGLE site via
 * User.primarySiteId. This DTO models the many-to-many ASSIGNED scope set that makes a
 * Foreman multi-site. primarySiteId stays the DEFAULT/primary site; the union of
 * primarySiteId + active assignments is the foreman's authorized scope (computed in the
 * back end's scope layer, owned by Servio).
 *
 * Mirrors SiteAssignment (worker⇄site): an ACTIVE assignment has unassignedAt = null.
 * This is the wire contract Servio's scope logic and the Manager assignment endpoint bind to.
 */
import { z } from 'zod';
import type { ID, ISODate, Timestamped } from './common';
import type { SiteStatus } from './enums';

/** Assignment linking a FOREMAN user to a site (many-to-many). */
export interface ForemanSiteAssignment extends Timestamped {
  id: ID;
  siteId: ID;
  /** The FOREMAN user assigned to this site. */
  foremanId: ID;
  /** When the foreman was assigned to this site. */
  assignedAt: ISODate;
  /** When the assignment ended, if it has. Active assignment = null/undefined. */
  unassignedAt?: ISODate | null;
}

/**
 * Create-input wire contract for the Manager assignment endpoint. A Manager assigns a
 * FOREMAN (foremanId) to a site (siteId). `assignedAt`/`unassignedAt` are managed
 * server-side. Re-assigning an existing (foremanId, siteId) pair REACTIVATES the row
 * (clears unassignedAt) rather than creating a duplicate — matching SiteAssignment's
 * @@unique([foremanId, siteId]) reactivate-in-place semantics.
 */
export const createForemanSiteAssignmentSchema = z.object({
  foremanId: z.string().min(1),
  siteId: z.string().min(1),
});

export type CreateForemanSiteAssignmentInput = z.infer<
  typeof createForemanSiteAssignmentSchema
>;

/**
 * A single site the CALLER foreman may pick, resolved to its Site name/status. Returned
 * by the SELF-scoped GET /foreman-sites (the foreman-facing multi-site picker source).
 *
 * The union is `User.primarySiteId` (isPrimary = true) + active ForemanSiteAssignment
 * rows, computed SERVER-side from the caller (req.appUser) — never a client-supplied
 * foremanId. This is the read-only, name-bearing projection of that scope union.
 */
export interface PickableSite {
  siteId: ID;
  name: string;
  /** True for the entry resolved from the foreman's primarySiteId. */
  isPrimary: boolean;
  status: SiteStatus;
}
