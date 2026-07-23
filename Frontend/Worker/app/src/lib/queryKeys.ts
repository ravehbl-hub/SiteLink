/** React Query key factory — one namespace shared across worker screens. */
import type { WorkingHoursParams } from './endpoints';

export const qk = {
  me: ['me'] as const,
  workingHours: (p: WorkingHoursParams) => ['workingHours', p] as const,
  requests: (p?: Record<string, unknown>) => ['requests', p ?? {}] as const,
};
