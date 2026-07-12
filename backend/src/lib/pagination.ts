/**
 * SiteLink back end — pagination helpers (NFR-PERF-2: bound list payloads).
 */
import { z } from 'zod';
import type { Paginated } from '@sitelink/shared';

export const PaginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export type PaginationParams = z.infer<typeof PaginationQuery>;

export function toSkipTake(params: PaginationParams): { skip: number; take: number } {
  return { skip: (params.page - 1) * params.pageSize, take: params.pageSize };
}

export function paginate<T>(
  items: T[],
  total: number,
  params: PaginationParams,
): Paginated<T> {
  return { items, total, page: params.page, pageSize: params.pageSize };
}
