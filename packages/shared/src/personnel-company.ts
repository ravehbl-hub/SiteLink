/**
 * @sitelink/shared — Personnel / staffing companies (org-wide, Manager-managed).
 *
 * A PersonnelCompany is a staffing company a Worker may belong to (see the
 * Worker.personnelCompanyRef FK). It is ORG-WIDE and NOT site-scoped — there is no
 * site relation on this entity and no per-site visibility rule. Admin+Manager
 * manage the full list; it is used as a picker source when editing a Worker.
 * v1-active.
 */
import { z } from 'zod';
import type { Archivable, ID, Timestamped } from './common';

/** A staffing / personnel company (FR-MGR-EMP-2). Org-wide, Manager-managed. */
export interface PersonnelCompany extends Timestamped, Archivable {
  id: ID;
  /**
   * MULTI-TENANCY (P2): the tenant this staffing company belongs to. READ-ONLY on the
   * wire — the server stamps it from the caller's own company; per-company uniqueness
   * is @@unique([companyId, name]). The FE never sends it.
   */
  companyId?: ID;
  /** Unique (per company) display name (e.g. the agency name). Required. */
  name: string;
  /** Optional primary contact person. */
  contactName?: string | null;
  /** Optional contact phone. */
  phone?: string | null;
  /** Optional contact email. */
  email?: string | null;
}

export interface CreatePersonnelCompanyInput {
  name: string;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
}

export type UpdatePersonnelCompanyInput = Partial<CreatePersonnelCompanyInput>;

// ── Zod wire contracts (create / update / list query) ──────────────────────
// The single source of truth the back end binds to and any front-end picker/form
// can import. Kept here (not in the back end) so both ends share one contract.

/**
 * Create input. `name` is required (min 1, trimmed → no whitespace-only names).
 * The three contact fields are optional and nullish; `email` is format-validated
 * only when a non-null value is supplied.
 */
export const createPersonnelCompanySchema = z.object({
  name: z.string().trim().min(1),
  contactName: z.string().trim().min(1).nullish(),
  phone: z.string().trim().min(1).nullish(),
  email: z.string().trim().email().nullish(),
});

/** Update input — every field optional (partial). Same validation when present. */
export const updatePersonnelCompanySchema = createPersonnelCompanySchema.partial();

/**
 * List query — consistent with listWorkersQuery. Archived rows are excluded unless
 * `includeArchived=true`. Coerced so a query-string `?includeArchived=true&page=2`
 * binds cleanly.
 */
export const listPersonnelCompaniesQuery = z.object({
  // NOTE: query-string values are strings — z.coerce.boolean('false') === true (any
  // non-empty string is truthy), which made `?includeArchived=false` read as true and
  // ALWAYS return archived-only. Parse the string explicitly: only 'true' → true.
  includeArchived: z
    .preprocess((v) => (typeof v === 'string' ? v === 'true' : v), z.boolean())
    .default(false),
  // MULTI-TENANCY (P2): ADMIN read-narrow to one company; IGNORED for a non-admin.
  companyId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
