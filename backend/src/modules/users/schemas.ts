/**
 * SiteLink back end — users module Zod schemas (FR-MGR-USER).
 */
import { z } from 'zod';
import { Language, Role, Theme } from '@sitelink/shared';

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
