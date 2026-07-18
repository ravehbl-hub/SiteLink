/** React Query key factory — one namespace shared across the Foreman screens. */
import type { DashboardParams } from './endpoints';

export const qk = {
  me: ['me'] as const,
  foremanSites: ['foremanSites'] as const,
  dashboard: (p: DashboardParams) => ['dashboard', p] as const,
  workers: (p?: { includeArchived?: boolean; siteId?: string; page?: number; pageSize?: number }) =>
    ['workers', p ?? {}] as const,
  worker: (id: string) => ['worker', id] as const,
  attendance: (p: Record<string, unknown>) => ['attendance', p] as const,
  workerRatings: (workerId: string) => ['workerRatings', workerId] as const,
  workerCount: (siteId: string | null) => ['workerCount', siteId] as const,
};
