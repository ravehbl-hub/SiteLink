/** React Query key factory (Architecture §3.3 — shared key philosophy). */
export const qk = {
  me: ['me'] as const,
  dashboard: (params: unknown) => ['dashboard', params] as const,
  sites: (params: unknown) => ['sites', params] as const,
  site: (id: string) => ['sites', id] as const,
  workers: (params: unknown) => ['workers', params] as const,
  worker: (id: string) => ['workers', id] as const,
  workerDocs: (id: string) => ['workers', id, 'docs'] as const,
  attendance: (params: unknown) => ['attendance', params] as const,
  workingHours: (params: unknown) => ['working-hours', params] as const,
  loans: (params: unknown) => ['loans', params] as const,
  advances: (params: unknown) => ['advances', params] as const,
  wageRates: ['wage-rates'] as const,
  users: (params: unknown) => ['users', params] as const,
};
