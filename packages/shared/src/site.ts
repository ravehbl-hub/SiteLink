/**
 * @sitelink/shared — Construction Sites domain (PRD §5.8 FR-MGR-SITE). v1-active.
 */
import type { Archivable, ID, ISODate, Timestamped } from './common';
import { SiteStatus } from './enums';

/** A construction site. Workers may be assigned to one or more sites (FR-MGR-SITE-4). */
export interface Site extends Timestamped, Archivable {
  id: ID;
  /**
   * MULTI-TENANCY (P2): the tenant this site belongs to. READ-ONLY on the wire — the
   * server stamps it from the creating caller's own company; the FE never sends it.
   */
  companyId?: ID;
  name: string;
  /** Optional human/site code or identifier (FR-MGR-SITE-2). */
  code?: string | null;
  status: SiteStatus;
  address?: string | null;
  /** When active work began on the site. */
  startedAt?: ISODate | null;
}

/** Assignment linking a worker to a site (many-to-many; FR-MGR-SITE-4). */
export interface SiteAssignment extends Timestamped {
  id: ID;
  siteId: ID;
  workerId: ID;
  /** When the worker was assigned to this site. */
  assignedAt: ISODate;
  /** When the assignment ended, if it has. */
  unassignedAt?: ISODate | null;
}

export interface CreateSiteInput {
  name: string;
  code?: string | null;
  address?: string | null;
  startedAt?: ISODate | null;
}

export interface UpdateSiteInput {
  name?: string;
  code?: string | null;
  address?: string | null;
  status?: SiteStatus;
  startedAt?: ISODate | null;
}
