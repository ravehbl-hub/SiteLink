/** React Query key factory — one namespace shared across screens. */
import type { DashboardParams, SalaryCalcParams } from './endpoints';

export const qk = {
  me: ['me'] as const,
  dashboard: (p: DashboardParams) => ['dashboard', p] as const,
  sites: (includeArchived: boolean) => ['sites', includeArchived] as const,
  site: (id: string) => ['site', id] as const,
  workers: (p?: { includeArchived?: boolean; siteId?: string }) => ['workers', p ?? {}] as const,
  worker: (id: string) => ['worker', id] as const,
  workerDocs: (id: string) => ['worker', id, 'docs'] as const,
  attendance: (p: Record<string, unknown>) => ['attendance', p] as const,
  wageRates: ['wageRates'] as const,
  loans: (p?: Record<string, unknown>) => ['loans', p ?? {}] as const,
  advances: (p?: Record<string, unknown>) => ['advances', p ?? {}] as const,
  requests: (p?: Record<string, unknown>) => ['requests', p ?? {}] as const,
  users: ['users'] as const,
  salary: (p: SalaryCalcParams) => ['salary', p] as const,
};
