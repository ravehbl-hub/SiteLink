/**
 * SiteLink back end — Auth & RBAC plugin (Architecture §5, PRD FR-X-AUTH/FR-X-RBAC).
 *
 * Authentication is owned by Supabase; this plugin is the single AUTHORIZATION
 * boundary:
 *   1. `authenticate` verifies the incoming Supabase JWT — signature + exp; extracts
 *      `sub` (the Supabase auth user id). Real Supabase sessions are signed ES256
 *      (asymmetric signing keys) and verified against the project JWKS; forged/legacy
 *      HS256 tokens are verified against SUPABASE_JWT_SECRET as a fallback.
 *   2. It resolves the app-level User row by `authUserId` to get role + site scope
 *      (NEVER trusts role claims from the token).
 *   3. Locked-out users are rejected (401) even with a valid token.
 *   4. `requireRole(...roles)` is a preHandler that enforces the role matrix; a
 *      forbidden action returns 403 with NO data leak (FR-X-RBAC-4).
 */
import fp from 'fastify-plugin';
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
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

    // Real Supabase sessions are ES256, signed with the project's rotating asymmetric
    // keys published at the auth JWKS endpoint. Build the remote key set ONCE — `jose`
    // caches fetched keys internally and refreshes on rotation, so this is not a
    // per-request network call.
    const issuer = `${app.config.SUPABASE_URL}/auth/v1`;
    const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));

    /** Verify the Supabase JWT and resolve the app User. */
    async function authenticate(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
      const token = extractBearer(req);

      let sub: string;
      try {
        // Branch on the token's signing algorithm:
        //   • ES256 → real Supabase access token → verify against the project JWKS
        //     (pinning issuer + audience, which the asymmetric path lets us assert).
        //   • HS256 → legacy/forged token signed with the project JWT secret.
        // Either way we verify signature + expiry and do NOT trust any role claims.
        let alg: string | undefined;
        try {
          alg = decodeProtectedHeader(token).alg;
        } catch {
          throw new Error('malformed token');
        }

        let payloadSub: string | undefined;
        if (alg === 'ES256') {
          const { payload } = await jwtVerify(token, jwks, {
            algorithms: ['ES256'],
            issuer,
            audience: 'authenticated',
          });
          payloadSub = payload.sub;
        } else {
          const { payload } = await jwtVerify(token, secret, {
            algorithms: ['HS256'],
          });
          payloadSub = payload.sub;
        }
        if (!payloadSub) throw new Error('no sub');
        sub = payloadSub;
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
        // Multi-tenancy: the caller's SERVER-side tenant. Every scoped query derives
        // its company filter from this — never from a client-supplied companyId.
        companyId: user.companyId,
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

/**
 * Phase 05 Stage B role bundles.
 *
 * FOREMAN_ROLES — Foreman-facing surfaces (site-scoped dashboard, attendance for
 * their site's workers, ratings). ADMIN/MANAGER are included so back-office staff
 * can exercise the same routes; the SERVICE layer applies Foreman site-scoping only
 * when the caller's role is FOREMAN (see scopeForForeman below). requireRole is the
 * COARSE gate; it is NEVER the whole authorization story for these routes.
 *
 * WORKER_ROLES — self-scoped Worker surfaces. Worker→Worker identity is the 1:1
 * FK Worker.userId (migration 20260713200000; NEVER the nullable/non-unique
 * Worker.email). Self-data endpoints (/working-hours, /salary/calculate,
 * /reports/payslip.pdf, /requests) resolve the caller's own worker via
 * lib/scope.resolveWorkerId / requireWorkerId (fail-closed: empty read / 403
 * write when unlinked). A WORKER cannot approve/reject (MANAGER-gated).
 *
 * BACKOFFICE_ROLES — ADMIN only this phase (NOT partner).
 */
export const FOREMAN_ROLES: Role[] = [Role.ADMIN, Role.MANAGER, Role.FOREMAN];
export const WORKER_ROLES: Role[] = [Role.WORKER];
export const BACKOFFICE_ROLES: Role[] = [Role.ADMIN];

/**
 * Users-module privilege boundary (prevents privilege escalation via the
 * Manager/Admin-gated /users surface).
 *
 * Returns the set of roles a caller may SEE and MANAGE (list/get/create/edit/
 * lockout/delete) on the /users module:
 *   - ADMIN   ⇒ ALL five roles (System Admin screen — no restriction).
 *   - MANAGER ⇒ {FOREMAN, WORKER, MANAGER} ONLY.
 *
 * PARTNER-EXCLUSION ASSUMPTION: the product owner's explicit list was
 * Foreman/Worker/Manager, so PARTNER (and ADMIN) are intentionally OUT of a
 * MANAGER's manageable set — a MANAGER can neither see nor act on ADMIN or
 * PARTNER users. If PARTNER should later be visible to MANAGERs, add Role.PARTNER
 * to the array below (one line) — no other code changes needed.
 *
 * This is the SERVER-SIDE authorization source of truth; UI hiding is never
 * sufficient. All /users enforcement derives from this set.
 */
const MANAGER_MANAGEABLE_ROLES: Role[] = [Role.FOREMAN, Role.WORKER, Role.MANAGER];

export function manageableRolesFor(caller: Pick<AuthUser, 'role'>): Role[] {
  if (caller.role === Role.ADMIN) {
    return [Role.ADMIN, Role.MANAGER, Role.PARTNER, Role.FOREMAN, Role.WORKER];
  }
  // MANAGER (the only other role that reaches the MANAGER_ROLES-gated /users
  // surface). Return a fresh copy so callers can't mutate the module constant.
  return [...MANAGER_MANAGEABLE_ROLES];
}
