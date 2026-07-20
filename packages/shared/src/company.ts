/**
 * @sitelink/shared — Multi-tenancy: Company (the app's primary security boundary).
 *
 * A Company is a TENANT. Every Manager/Foreman/Worker belongs to exactly one
 * Company (User.companyId, server-derived — NEVER client-supplied for identity).
 * A System Admin (Role.ADMIN) is a super-admin ABOVE all companies. This is a NEW
 * model linked 1:1 (at-most-one) to the billing Customer — NOT a rename — so the
 * authorization boundary stays decoupled from the optional billing model.
 *
 * These are the wire contracts for the ADMIN-only System-Admin company endpoints
 * (/companies). Fields align field-for-field with the Prisma Company model
 * (Date → ISO string).
 */
import { z } from 'zod';
import type { Archivable, ID, Timestamped } from './common';

/** A tenant company (the primary multi-tenancy boundary). Soft-deletable. */
export interface Company extends Timestamped, Archivable {
  id: ID;
  name: string;
  /** Optional 1:1 (at-most-one) link to the billing Customer. */
  customerId?: ID | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Zod input contracts — validated at the route edge (ADMIN-only /companies).
// ─────────────────────────────────────────────────────────────────────────────

/** POST /companies */
export const createCompanySchema = z.object({
  name: z.string().min(1),
  /** Optional 1:1 billing-customer link; @unique is enforced server-side. */
  customerId: z.string().min(1).nullish(),
});
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;

/** PATCH /companies/:id */
export const updateCompanySchema = z.object({
  name: z.string().min(1).optional(),
  customerId: z.string().min(1).nullish(),
});
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
