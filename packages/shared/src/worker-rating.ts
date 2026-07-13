/**
 * @sitelink/shared — Foreman worker ratings (PRD FR-FOR-5).
 * A FOREMAN rates a worker's performance on a given date. `score` is a numeric
 * 1..5 rating (a per-event, averageable signal) — distinct from Worker.level
 * (WorkerLevel), which is the Manager's single authoritative classification.
 *
 * This is the wire contract Stage B (Servio) will bind the endpoint to.
 */
import { z } from 'zod';
import type { ID, ISODate, Timestamped } from './common';

/** Bounds of the rating scale (inclusive). Kept as named constants so the DTO
 *  and the Zod schema cannot drift. */
export const WORKER_RATING_MIN_SCORE = 1;
export const WORKER_RATING_MAX_SCORE = 5;

/** A single Foreman-authored rating of a worker on a date (FR-FOR-5). */
export interface WorkerRating extends Timestamped {
  id: ID;
  workerId: ID;
  /** The FOREMAN user who authored the rating. */
  foremanId: ID;
  /** The date the rating applies to (calendar date, no time component). */
  date: ISODate;
  /** Performance score, an integer in [WORKER_RATING_MIN_SCORE, WORKER_RATING_MAX_SCORE]. */
  score: number;
  notes?: string | null;
}

/**
 * Create-input wire contract. `foremanId` is NOT accepted from the client — it is
 * derived server-side from the authenticated FOREMAN (Stage B), mirroring how
 * WorkerRequest resolution derives resolvedById from the caller.
 */
export const createWorkerRatingSchema = z.object({
  workerId: z.string().min(1),
  /** ISO calendar date, e.g. "2026-07-13". */
  date: z.string().min(1),
  score: z
    .number()
    .int()
    .min(WORKER_RATING_MIN_SCORE)
    .max(WORKER_RATING_MAX_SCORE),
  notes: z.string().nullish(),
});

export type CreateWorkerRatingInput = z.infer<typeof createWorkerRatingSchema>;
