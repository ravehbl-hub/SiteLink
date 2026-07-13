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
      const user = await prisma.user.findUnique({ where: { id: appUser.id } });
      if (!user) throw AppError.unauthorized();
      // Data minimization: strip authUserId (the Supabase identity FK) from the
      // /auth/me projection — the client never needs it (nexo LOW).
      const { authUserId: _authUserId, ...safe } = mapUser(user);
      return { user: safe };
    },
  );
}
