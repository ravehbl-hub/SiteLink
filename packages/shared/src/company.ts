/**
 * @sitelink/shared — Company: the app's primary security boundary AND billing subject.
 *
 * A Company is a TENANT. Every Manager/Foreman/Worker belongs to exactly one
 * Company (User.companyId, server-derived — NEVER client-supplied for identity).
 * A System Admin (Role.ADMIN) is a super-admin ABOVE all companies. The former
 * standalone billing `Customer` model was MERGED into Company (Option C): its contact
 * and lifecycle fields now live here, and Billing/Usage/PnL key off companyId.
 *
 * These are the wire contracts for the ADMIN-only System-Admin company endpoints
 * (/companies). Fields align field-for-field with the Prisma Company model
 * (Date → ISO string).
 */
import { z } from 'zod';
import type { Archivable, ID, ISODate, Timestamped } from './common';

/** A tenant company (the primary multi-tenancy boundary + billing subject). Soft-deletable. */
export interface Company extends Timestamped, Archivable {
  id: ID;
  name: string;
  /** Billing contact + lifecycle (merged from the former Customer model). */
  contactEmail?: string | null;
  contactPhone?: string | null;
  /** When the tenant/account registered; leftAt = when it churned (null = active). */
  registeredAt: ISODate;
  leftAt?: ISODate | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Zod input contracts — validated at the route edge (ADMIN-only /companies).
// ─────────────────────────────────────────────────────────────────────────────

/** POST /companies — company create now carries billing contact/lifecycle directly. */
export const createCompanySchema = z.object({
  name: z.string().min(1),
  contactEmail: z.string().email().nullish(),
  contactPhone: z.string().min(1).nullish(),
  registeredAt: z.string().datetime().nullish(),
});
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;

/** PATCH /companies/:id */
export const updateCompanySchema = z.object({
  name: z.string().min(1).optional(),
  contactEmail: z.string().email().nullish(),
  contactPhone: z.string().min(1).nullish(),
  registeredAt: z.string().datetime().optional(),
  leftAt: z.string().datetime().nullish(),
});
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
