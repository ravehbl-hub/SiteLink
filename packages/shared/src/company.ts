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

/**
 * Inline creation of a NEW billing Customer to link 1:1 with the company being
 * created — so the System Admin can provision the tenant Company and its billing
 * Customer in ONE step instead of maintaining two separate lists. Mutually exclusive
 * with `customerId` (see the refine on createCompanySchema). Server creates the
 * Customer and links it atomically.
 */
export const newCustomerSchema = z.object({
  name: z.string().min(1),
  contactEmail: z.string().email().nullish(),
  contactPhone: z.string().min(1).nullish(),
});
export type NewCustomerInput = z.infer<typeof newCustomerSchema>;

/** POST /companies */
export const createCompanySchema = z
  .object({
    name: z.string().min(1),
    /** Optional 1:1 billing-customer link to an EXISTING customer; @unique server-side. */
    customerId: z.string().min(1).nullish(),
    /** Optional inline-create of a NEW billing customer to link (see newCustomerSchema). */
    newCustomer: newCustomerSchema.nullish(),
  })
  .refine((v) => !(v.customerId && v.newCustomer), {
    message: 'Provide either an existing customerId or a newCustomer, not both',
    path: ['newCustomer'],
  });
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;

/** PATCH /companies/:id */
export const updateCompanySchema = z.object({
  name: z.string().min(1).optional(),
  customerId: z.string().min(1).nullish(),
});
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
