/**
 * SiteLink back end — auth module (Architecture §5.5).
 *
 * Login/refresh/logout are owned by Supabase (client SDK), so the only endpoint
 * here is GET /auth/me: returns the app-level profile (role, site scope, prefs)
 * for the verified Supabase identity. Requires a valid JWT.
 */
import type { FastifyInstance } from 'fastify';
import type { CurrentUser } from '@sitelink/shared';
import { prisma } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { mapUser } from '../../lib/mappers.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/auth/me',
    { preHandler: app.authenticate },
    async (req): Promise<CurrentUser> => {
      const appUser = req.appUser!;
      const user = await prisma.user.findUnique({
        where: { id: appUser.id },
        include: { company: { select: { name: true } } },
      });
      if (!user) throw AppError.unauthorized();
      // LAST ENTRANCE: /auth/me is the first authenticated call after a Supabase sign-in,
      // so stamp lastLoginAt here. Throttled to a 10-minute window so in-session page
      // reloads (which also hit /auth/me) don't re-stamp it on every request — it marks
      // the start of an entrance, not raw activity. Populates the admin list's "Last login".
      const THROTTLE_MS = 10 * 60_000;
      if (!user.lastLoginAt || Date.now() - user.lastLoginAt.getTime() > THROTTLE_MS) {
        const now = new Date();
        await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: now } });
        user.lastLoginAt = now; // reflect in this response's projection
      }
      // Data minimization: strip authUserId (the Supabase identity FK) from the
      // /auth/me projection — the client never needs it (nexo LOW).
      const { authUserId: _authUserId, ...safe } = mapUser(user);
      // Self-scoped: the joined company is the caller's OWN tenant (User.companyId,
      // server-derived). Surfaced read-only in Settings. Null if the row is missing.
      return { user: safe, companyName: user.company?.name ?? null };
    },
  );
}
