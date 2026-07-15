/**
 * SiteLink back end — workers module Zod schemas (FR-MGR-EMP).
 */
import { z } from 'zod';
import { Profession, RateType, WorkerDocType, WorkerLevel } from '@sitelink/shared';

export const createWorkerSchema = z.object({
  firstName: z.string().min(1), // required (FR-MGR-EMP-7)
  lastName: z.string().min(1), // required
  profession: z.nativeEnum(Profession), // required (FR-MGR-EMP-8)
  level: z.nativeEnum(WorkerLevel).default(WorkerLevel.MEDIUM),
  country: z.string().nullish(),
  address: z.string().nullish(),
  qualityOfWorks: z.string().nullish(),
  phone: z.string().nullish(),
  // REQUIRED for NEW workers (Phase 05 Stage C, forward-only). Worker create ALWAYS
  // dual-writes a WORKER login provisioned from this email — there is no login-less
  // create path anymore. The 4 legacy login-less workers are NOT backfilled.
  email: z.string().email(),
  // Optional Manager-set initial password. Omit → Supabase INVITE email (worker sets
  // their own password), consistent with the Users Manager flow.
  password: z.string().min(8).optional(),
  personnelCompany: z.string().nullish(),
  residence: z.string().nullish(),
  startDate: z.string().datetime().nullish(),
  siteIds: z.array(z.string()).optional(),
  // Optional Worker Salary data captured in the wizard (FR-MGR-EMP-4).
  salaryData: z
    .object({
      hourlyWage: z.number().nonnegative(),
      rateType: z.nativeEnum(RateType).default(RateType.HOURLY),
      workingConditions: z.string().nullish(),
      currency: z.string().default('ILS'),
    })
    .optional(),
});

export const updateWorkerSchema = createWorkerSchema.partial();

export const salaryDataSchema = z.object({
  hourlyWage: z.number().nonnegative(),
  rateType: z.nativeEnum(RateType).default(RateType.HOURLY),
  workingConditions: z.string().nullish(),
  currency: z.string().default('ILS'),
});

export const listWorkersQuery = z.object({
  includeArchived: z.coerce.boolean().default(false),
  siteId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/** Request a signed upload URL for a worker doc (server chooses the key). */
export const requestDocUploadSchema = z.object({
  type: z.nativeEnum(WorkerDocType),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive().optional(),
});

/** Confirm a completed upload → persist the FileRef row. */
export const confirmDocSchema = z.object({
  type: z.nativeEnum(WorkerDocType),
  storageKey: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive().optional(),
  reference: z.string().nullish(),
  expiresAt: z.string().datetime().nullish(),
});

/** Request a signed upload URL for the worker profile image (server chooses key). */
export const requestImageUploadSchema = z.object({
  fileName: z.string().min(1),
  // Profile image is image/* only (no PDF) — a stricter allow-list than docs.
  mimeType: z.string().regex(/^image\//, 'Profile image must be an image/* type'),
  sizeBytes: z.number().int().positive().optional(),
});

/** Confirm a completed image upload → persist the FileRef onto Worker.image. */
export const confirmImageSchema = z.object({
  storageKey: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().regex(/^image\//, 'Profile image must be an image/* type'),
  sizeBytes: z.number().int().positive().optional(),
});

export const idParam = z.object({ id: z.string().min(1) });
export const docParam = z.object({ id: z.string().min(1), docId: z.string().min(1) });
