/**
 * SiteLink back end — users service (FR-MGR-USER + Architecture §5.4).
 *
 * The add-user flow is a DUAL-WRITE across two systems in one unit of work:
 *   1. Supabase Admin API creates/invites the identity → returns authUserId.
 *   2. App User row is written keyed by that authUserId.
 * If step 2 fails, we COMPENSATE by deleting the just-created Supabase user so no
 * orphaned identity is left. Lockout is mirrored to Supabase (ban/unban).
 */
import type { z } from 'zod';
import type { User, Paginated } from '@sitelink/shared';
import { Role } from '@sitelink/shared';
import { prisma } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { mapUser } from '../../lib/mappers.js';
import type { SupabaseService } from '../../lib/supabase.js';
import { manageableRolesFor } from '../../plugins/auth.js';
import type { AuthUser } from '../../plugins/types.js';
import { paginate, type PaginationParams, toSkipTake } from '../../lib/pagination.js';
import {
  companyWhere,
  effectiveCompanyScope,
  resolveCompanyScope,
  type CompanyScope,
} from '../../lib/scope.js';
import type { createUserSchema, listUsersQuerySchema, updateUserSchema } from './schemas.js';

type CreateInput = z.infer<typeof createUserSchema>;
type UpdateInput = z.infer<typeof updateUserSchema>;
type ListInput = z.infer<typeof listUsersQuerySchema>;

/**
 * The caller identity threaded from the route into every service method. BOTH
 * `role` (the privilege boundary — manageableRolesFor) AND `companyId` (the
 * multi-tenancy boundary — company scope) are load-bearing: every list where,
 * every target load, and every create-stamp derives from these SERVER-side values.
 * A client-supplied companyId NEVER reaches this — only req.appUser.companyId does.
 */
type Caller = Pick<AuthUser, 'role' | 'companyId'>;

export class UsersService {
  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Compute the effective role filter for a list request:
   *   effective = (requested ? {requested} : manageable) ∩ manageable
   * A MANAGER passing ?role=ADMIN yields [] → an empty page (never ADMIN rows).
   */
  private effectiveListRoles(caller: Caller, requested?: Role): Role[] {
    const manageable = manageableRolesFor(caller);
    if (!requested) return manageable;
    return manageable.includes(requested) ? [requested] : [];
  }

  /**
   * Load a target user and enforce that the caller may act on it. TWO boundaries,
   * BOTH must pass (ANDed):
   *   1. TENANT: the target must be inside the caller's company scope. For a
   *      non-admin this is their OWN company; a cross-company target is treated as
   *      NOT-FOUND (404) — never confirming the row exists in another tenant. ADMIN
   *      (allCompanies) skips the tenant filter.
   *   2. ROLE-VISIBILITY: the target's CURRENT role must be in the caller's
   *      manageable set (else 403 — prevents acting on a hidden role by id-guessing).
   *
   * The tenant check runs FIRST and 404s, so a Manager can never even distinguish a
   * company-B ADMIN from a non-existent id. Returns the row for the caller to mutate.
   */
  private async loadManageableTarget(caller: Caller, id: string) {
    const scope = resolveCompanyScope(caller);
    // Fetch WITH the company filter baked into the where (a manager's query can only
    // ever return a same-company row). ADMIN → {} → any company.
    const row = await prisma.user.findFirst({
      where: { id, ...companyWhere(scope) },
    });
    // A cross-company (or non-existent) id → 404: never confirm existence in another
    // tenant, and NEVER mutate. This is the catastrophic-leak guard.
    if (!row) throw AppError.notFound('User not found');
    if (!manageableRolesFor(caller).includes(row.role as Role)) {
      throw AppError.forbidden();
    }
    return row;
  }

  async list(caller: Caller, params: ListInput): Promise<Paginated<User>> {
    const { skip, take } = toSkipTake(params);
    const roles = this.effectiveListRoles(caller, params.role);
    // Empty effective set (e.g. MANAGER + ?role=ADMIN) → empty page, no query.
    if (roles.length === 0) return paginate<User>([], 0, params);

    // TENANT filter ANDed with role-visibility. ADMIN may narrow to one company via
    // ?companyId (READ narrowing); a non-admin's ?companyId is IGNORED — they always
    // see ONLY their own company. So a manager's list = role IN manageable AND
    // companyId = own; a company-B row can NEVER appear.
    const scope = effectiveCompanyScope(caller, params.companyId);
    const where = { ...companyWhere(scope), role: { in: roles } };
    const [rows, total] = await Promise.all([
      prisma.user.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      prisma.user.count({ where }),
    ]);
    return paginate(rows.map(mapUser), total, params);
  }

  async get(caller: Caller, id: string): Promise<User> {
    const row = await this.loadManageableTarget(caller, id);
    return mapUser(row);
  }

  /**
   * Resolve the SERVER-authoritative tenant a new user is stamped with (never a
   * blindly-trusted client value):
   *   - MANAGER (non-admin) → the creator's OWN companyId. Any `input.companyId`
   *     is IGNORED — a Manager can NEVER create into another company by request
   *     shaping. (resolveCompanyScope pins a non-admin to their own company.)
   *   - ADMIN → the REQUIRED `input.companyId` (creating a Manager INTO a company).
   *     The company must exist and NOT be archived; otherwise the create is refused.
   */
  private async resolveCreateCompanyId(caller: Caller, input: CreateInput): Promise<string> {
    const scope = resolveCompanyScope(caller);
    if ('companyId' in scope) {
      // Non-admin: own company, full stop. input.companyId is never read here.
      return scope.companyId;
    }
    // ADMIN caller (allCompanies).
    // A NEW SYSTEM ADMIN (role === ADMIN) is a super-admin that manages EVERY company —
    // it belongs to no single tenant, and companyId is IGNORED for an admin's authz
    // (resolveCompanyScope → allCompanies). So we do NOT require a target company for an
    // admin create; we stamp a harmless placeholder (the creating admin's own company)
    // purely to satisfy the NOT-NULL column. An explicitly supplied, valid companyId is
    // still honored.
    if (input.role === Role.ADMIN) {
      if (input.companyId) {
        const c = await prisma.company.findUnique({ where: { id: input.companyId } });
        if (c && !c.isArchived) return c.id;
      }
      return caller.companyId; // placeholder tenant — never used for an admin's scope
    }
    // Creating a NON-admin (Manager/Foreman/Worker/Partner) → a real, live target
    // company is mandatory (they see only that company's data).
    if (!input.companyId) {
      throw AppError.validation('companyId is required when an admin creates a user');
    }
    const company = await prisma.company.findUnique({ where: { id: input.companyId } });
    if (!company || company.isArchived) {
      throw AppError.validation('Target company does not exist or is archived');
    }
    return company.id;
  }

  async create(caller: Caller, input: CreateInput): Promise<User> {
    // Privilege boundary: a caller may only create a role within their manageable
    // set (validated against manageableRolesFor, not just the Zod enum). A MANAGER
    // creating ADMIN/PARTNER → 403; ADMIN may create any role.
    if (!manageableRolesFor(caller).includes(input.role)) {
      throw AppError.forbidden();
    }

    // TENANT stamp (server-derived). MANAGER → own company (client companyId ignored);
    // ADMIN → the validated target company. Resolved BEFORE the Supabase write so an
    // invalid company never provisions an orphan identity.
    const companyId = await this.resolveCreateCompanyId(caller, input);

    // Guard the app-side unique constraint up front (email is unique). Use the
    // dedicated USER_EMAIL_EXISTS code so the client shows the friendly message —
    // same code the Supabase-side duplicate mapping uses (mapCreateAuthError).
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new AppError('USER_EMAIL_EXISTS', 'A user with this email already exists');
    }

    // Step 1 — provision the Supabase identity.
    const { authUserId } = await this.supabase.createAuthUser({
      email: input.email,
      password: input.password,
    });

    // Step 2 — dual-write the app User row; roll back Supabase on failure.
    try {
      const row = await prisma.user.create({
        data: {
          authUserId,
          companyId,
          role: input.role,
          fullName: input.fullName,
          email: input.email,
          primarySiteId: input.primarySiteId ?? null,
          ...(input.language ? { language: input.language } : {}),
          ...(input.theme ? { theme: input.theme } : {}),
        },
      });
      return mapUser(row);
    } catch (err) {
      // Compensating action — delete the orphaned Supabase identity.
      await this.supabase.deleteAuthUser(authUserId).catch(() => undefined);
      throw AppError.conflict('Failed to persist user; provisioning rolled back');
    }
  }

  async update(caller: Caller, id: string, input: UpdateInput): Promise<User> {
    // Enforce the target's CURRENT role is manageable BEFORE mutating (403 if the
    // caller is a MANAGER acting on an ADMIN/PARTNER — even by guessing the id).
    const current = await this.loadManageableTarget(caller, id);

    // Role-change guard: a MANAGER cannot promote a user TO a role outside their
    // set (ADMIN/PARTNER). The new role must also be manageable. (The old role was
    // already validated above.) ADMIN is unrestricted.
    if (input.role !== undefined && !manageableRolesFor(caller).includes(input.role)) {
      throw AppError.forbidden();
    }

    // If lockout is being changed, mirror it to Supabase (ban/unban).
    if (input.isLockedOut !== undefined && input.isLockedOut !== current.isLockedOut) {
      await this.supabase.setUserLockout(current.authUserId, input.isLockedOut);
    }

    // ADMIN-set the target's password on Supabase (credentials live there, not app DB).
    // The manageable-role guard above already authorized the caller for this target.
    if (input.password) {
      await this.supabase.setUserPassword(current.authUserId, input.password);
    }

    const row = await prisma.user.update({
      where: { id },
      data: {
        ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.primarySiteId !== undefined
          ? { primarySiteId: input.primarySiteId }
          : {}),
        ...(input.isLockedOut !== undefined ? { isLockedOut: input.isLockedOut } : {}),
        ...(input.language !== undefined ? { language: input.language } : {}),
        ...(input.theme !== undefined ? { theme: input.theme } : {}),
      },
    });
    return mapUser(row);
  }

  async setLockout(caller: Caller, id: string, isLockedOut: boolean): Promise<User> {
    const current = await this.loadManageableTarget(caller, id);
    await this.supabase.setUserLockout(current.authUserId, isLockedOut);
    const row = await prisma.user.update({ where: { id }, data: { isLockedOut } });
    return mapUser(row);
  }

  async remove(caller: Caller, id: string): Promise<void> {
    const current = await this.loadManageableTarget(caller, id);
    // Remove app row first, then the Supabase identity (best-effort).
    await prisma.user.delete({ where: { id } });
    await this.supabase.deleteAuthUser(current.authUserId).catch(() => undefined);
  }
}
