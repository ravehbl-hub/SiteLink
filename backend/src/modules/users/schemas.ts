/**
 * SiteLink back end — users module Zod schemas (FR-MGR-USER).
 */
import { z } from 'zod';
import { Language, Role, Theme } from '@sitelink/shared';
import { PaginationQuery } from '../../lib/pagination.js';

/**
 * GET /users query. Pagination + an OPTIONAL `role` filter.
 *
 * `role` is ADDITIVE on top of the caller's manageable-role scope (see the
 * service): effective roles = (role ? {role} : manageableRolesFor(caller))
 * ∩ manageableRolesFor(caller). So a MANAGER passing ?role=ADMIN gets an empty
 * page (the intersection is empty) — never ADMIN rows.
 */
export const listUsersQuerySchema = PaginationQuery.extend({
  role: z.nativeEnum(Role).optional(),
});

export const createUserSchema = z.object({
  role: z.nativeEnum(Role),
  fullName: z.string().min(1),
  email: z.string().email(),
  // Optional: omit to send a Supabase invite (user sets own password).
  password: z.string().min(8).optional(),
  primarySiteId: z.string().nullish(),
  language: z.nativeEnum(Language).optional(),
  theme: z.nativeEnum(Theme).optional(),
});

export const updateUserSchema = z.object({
  fullName: z.string().min(1).optional(),
  email: z.string().email().optional(),
  role: z.nativeEnum(Role).optional(),
  primarySiteId: z.string().nullish(),
  isLockedOut: z.boolean().optional(),
  language: z.nativeEnum(Language).optional(),
  theme: z.nativeEnum(Theme).optional(),
});

export const lockoutSchema = z.object({
  isLockedOut: z.boolean(),
});

export const idParam = z.object({ id: z.string().min(1) });
