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
import { prisma } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { mapUser } from '../../lib/mappers.js';
import type { SupabaseService } from '../../lib/supabase.js';
import { paginate, type PaginationParams, toSkipTake } from '../../lib/pagination.js';
import type { createUserSchema, updateUserSchema } from './schemas.js';

type CreateInput = z.infer<typeof createUserSchema>;
type UpdateInput = z.infer<typeof updateUserSchema>;

export class UsersService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(params: PaginationParams): Promise<Paginated<User>> {
    const { skip, take } = toSkipTake(params);
    const [rows, total] = await Promise.all([
      prisma.user.findMany({ skip, take, orderBy: { createdAt: 'desc' } }),
      prisma.user.count(),
    ]);
    return paginate(rows.map(mapUser), total, params);
  }

  async get(id: string): Promise<User> {
    const row = await prisma.user.findUnique({ where: { id } });
    if (!row) throw AppError.notFound('User not found');
    return mapUser(row);
  }

  async create(input: CreateInput): Promise<User> {
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

  async update(id: string, input: UpdateInput): Promise<User> {
    const current = await prisma.user.findUnique({ where: { id } });
    if (!current) throw AppError.notFound('User not found');

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

  async setLockout(id: string, isLockedOut: boolean): Promise<User> {
    const current = await prisma.user.findUnique({ where: { id } });
    if (!current) throw AppError.notFound('User not found');
    await this.supabase.setUserLockout(current.authUserId, isLockedOut);
    const row = await prisma.user.update({ where: { id }, data: { isLockedOut } });
    return mapUser(row);
  }

  async remove(id: string): Promise<void> {
    const current = await prisma.user.findUnique({ where: { id } });
    if (!current) throw AppError.notFound('User not found');
    // Remove app row first, then the Supabase identity (best-effort).
    await prisma.user.delete({ where: { id } });
    await this.supabase.deleteAuthUser(current.authUserId).catch(() => undefined);
  }
}
