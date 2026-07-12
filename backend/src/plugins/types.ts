/**
 * SiteLink back end — Fastify type augmentation.
 *
 * Declares the decorators/hooks the plugins add to the Fastify instance and to
 * each request, so route handlers get full type-safety on `req.appUser`,
 * `app.config`, `app.supabase`, `app.requireRole(...)`, etc.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Role } from '@sitelink/shared';
import type { AppConfig } from '../config.js';
import type { SupabaseService } from '../lib/supabase.js';

/** The app-level authenticated user resolved from the verified Supabase JWT. */
export interface AuthUser {
  /** Our User.id. */
  id: string;
  /** Supabase auth user id (JWT `sub`). */
  authUserId: string;
  role: Role;
  email: string;
  fullName: string;
  primarySiteId: string | null;
  isLockedOut: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    supabase: SupabaseService;
    /** preHandler that verifies the Supabase JWT and populates req.appUser. */
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** preHandler factory: require the user to hold one of the given roles. */
    requireRole: (
      ...roles: Role[]
    ) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    /** Present only after `authenticate` runs. */
    appUser?: AuthUser;
  }
}
