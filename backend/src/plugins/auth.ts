/**
 * SiteLink back end — Auth & RBAC plugin (Architecture §5, PRD FR-X-AUTH/FR-X-RBAC).
 *
 * Authentication is owned by Supabase; this plugin is the single AUTHORIZATION
 * boundary:
 *   1. `authenticate` verifies the incoming Supabase JWT (HS256, SUPABASE_JWT_SECRET)
 *      — signature + exp; extracts `sub` (the Supabase auth user id).
 *   2. It resolves the app-level User row by `authUserId` to get role + site scope
 *      (NEVER trusts role claims from the token).
 *   3. Locked-out users are rejected (401) even with a valid token.
 *   4. `requireRole(...roles)` is a preHandler that enforces the role matrix; a
 *      forbidden action returns 403 with NO data leak (FR-X-RBAC-4).
 */
import fp from 'fastify-plugin';
import { jwtVerify } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Role } from '@sitelink/shared';
import { prisma } from '../db/client.js';
import { AppError } from '../lib/errors.js';
import type { AuthUser } from './types.js';

function extractBearer(req: FastifyRequest): string {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw AppError.unauthorized('Missing bearer token');
  }
  return header.slice('Bearer '.length).trim();
}

export default fp(
  async (app) => {
    const secret = new TextEncoder().encode(app.config.SUPABASE_JWT_SECRET);

    /** Verify the Supabase JWT and resolve the app User. */
    async function authenticate(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
      const token = extractBearer(req);

      let sub: string;
      try {
        // Supabase signs access tokens with HS256 using the project JWT secret.
        // `aud` is typically "authenticated"; we accept the default and rely on
        // signature + expiry. We do NOT trust any role/claims here.
        const { payload } = await jwtVerify(token, secret, {
          algorithms: ['HS256'],
        });
        if (!payload.sub) throw new Error('no sub');
        sub = payload.sub;
      } catch {
        // Uniform 401 — never reveal why (expired vs malformed vs bad signature).
        throw AppError.unauthorized('Invalid or expired token');
      }

      const user = await prisma.user.findUnique({ where: { authUserId: sub } });
      if (!user) {
        // Valid Supabase identity but no app authorization record → treat as unauth.
        throw AppError.unauthorized('No application account for this identity');
      }
      if (user.isLockedOut) {
        throw AppError.unauthorized('Account is locked');
      }

      const appUser: AuthUser = {
        id: user.id,
        authUserId: user.authUserId,
        role: user.role as Role,
        email: user.email,
        fullName: user.fullName,
        primarySiteId: user.primarySiteId ?? null,
        isLockedOut: user.isLockedOut,
      };
      req.appUser = appUser;
    }

    /** Role-gate factory. Runs after `authenticate`. */
    function requireRole(...roles: Role[]) {
      return async function roleGuard(
        req: FastifyRequest,
        _reply: FastifyReply,
      ): Promise<void> {
        const appUser = req.appUser;
        if (!appUser) {
          // Defensive: requireRole must be chained after authenticate.
          throw AppError.unauthorized();
        }
        if (!roles.includes(appUser.role)) {
          throw AppError.forbidden();
        }
      };
    }

    app.decorate('authenticate', authenticate);
    app.decorate('requireRole', requireRole);
  },
  { name: 'auth' },
);

/**
 * Convenience role bundles used across modules. v1 gates every Manager surface to
 * ADMIN + MANAGER (Admin ⊃ Manager). PARTNER gets read where noted in a route.
 */
export const MANAGER_ROLES: Role[] = [Role.ADMIN, Role.MANAGER];
export const READ_ROLES: Role[] = [Role.ADMIN, Role.MANAGER, Role.PARTNER];
