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
import type { createUserSchema, listUsersQuerySchema, updateUserSchema } from './schemas.js';

type CreateInput = z.infer<typeof createUserSchema>;
type UpdateInput = z.infer<typeof updateUserSchema>;
type ListInput = z.infer<typeof listUsersQuerySchema>;

/**
 * The caller identity threaded from the route into every service method. Only the
 * role is load-bearing for the users-module privilege boundary, but we accept the
 * full AuthUser for clarity/future use.
 */
type Caller = Pick<AuthUser, 'role'>;

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
   * Load a target user and enforce that the caller may act on it. If the target's
   * CURRENT role is outside the caller's manageable set → 403 (prevents acting on a
   * hidden user by guessing its id). Returns the row for the caller to mutate.
   */
  private async loadManageableTarget(caller: Caller, id: string) {
    const row = await prisma.user.findUnique({ where: { id } });
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

    const where = { role: { in: roles } };
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

  async create(caller: Caller, input: CreateInput): Promise<User> {
    // Privilege boundary: a caller may only create a role within their manageable
    // set (validated against manageableRolesFor, not just the Zod enum). A MANAGER
    // creating ADMIN/PARTNER → 403; ADMIN may create any role.
    if (!manageableRolesFor(caller).includes(input.role)) {
      throw AppError.forbidden();
    }

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
