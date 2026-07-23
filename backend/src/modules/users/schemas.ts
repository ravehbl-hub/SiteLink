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
  /**
   * ADMIN-ONLY READ narrowing: an ADMIN may pass ?companyId to view a single
   * tenant's users. IGNORED for a MANAGER (effectiveCompanyScope pins a non-admin
   * to their own company regardless — a Manager can never widen via this field).
   */
  companyId: z.string().min(1).optional(),
});

export const createUserSchema = z.object({
  role: z.nativeEnum(Role),
  fullName: z.string().min(1),
  email: z.string().email(),
  // Optional: omit to send a Supabase invite (user sets own password).
  password: z.string().min(8).optional(),
  /**
   * TENANT for the new user. ADMIN-only + REQUIRED for an ADMIN (create a Manager
   * INTO a company). IGNORED for a MANAGER — the service stamps the MANAGER'S OWN
   * companyId, never this client value.
   */
  companyId: z.string().min(1).optional(),
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
  // Optional: when present, ADMIN-set the target's Supabase password (min 8). Not
  // persisted in the app DB — Supabase owns credentials.
  password: z.string().min(8).optional(),
});

export const lockoutSchema = z.object({
  isLockedOut: z.boolean(),
});

export const idParam = z.object({ id: z.string().min(1) });
