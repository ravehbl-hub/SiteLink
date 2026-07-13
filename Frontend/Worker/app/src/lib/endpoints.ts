/**
 * Typed endpoint wrappers over the REST contract, using @sitelink/shared DTOs.
 *
 * SELF-SCOPE RULE (Styllo, Worker app): every route here is WORKER-role and
 * auto-scoped server-side to the caller's own worker (via Worker.userId). The
 * client NEVER sends a workerId — the back end forces self. There is no worker
 * picker anywhere in this app.
 */
import type {
  CurrentUser,
  Paginated,
  RequestStatus,
  RequestType,
  SalaryResult,
  WorkerRequest,
  WorkingHours,
} from '@sitelink/shared';
import { api } from './api';

/** Unwrap a list response that may be a bare array or a Paginated envelope. */
function toArray<T>(res: T[] | Paginated<T>): T[] {
  return Array.isArray(res) ? res : res.items;
}

/** Aggregation grain for the self working-hours view (FR-WRK-1). Lowercase wire form. */
export type WorkingHoursGrainParam = 'day' | 'week' | 'month';

/** PDF export language (matches the reports route `lang` contract). */
export type ReportLang = 'he' | 'en' | 'tr';

export interface WorkingHoursParams {
  from: string;
  to: string;
  grain: WorkingHoursGrainParam;
}

export interface SalaryCalcParams {
  periodStart: string;
  periodEnd: string;
}

/**
 * Unified request-create body (FR-WRK-3/4/5). All three request kinds submit
 * through POST /requests. workerId + requestedById are server-derived; status
 * defaults PENDING. See @sitelink/shared CreateRequestInput / backend
 * requests/schemas.ts — this omits workerId because the back end forces self.
 */
export interface CreateSelfRequestInput {
  type: RequestType;
  /** VACATION range. */
  startDate?: string | null;
  endDate?: string | null;
  /** LOAN / ADVANCE amount. */
  amount?: number | null;
  currency?: string | null;
  notes?: string | null;
}

export const endpoints = {
  // Auth
  me: () => api.get<CurrentUser>('/auth/me'),

  // Working hours (self-scoped; returns the caller's own aggregates) — FR-WRK-1
  workingHours: (params: WorkingHoursParams) => api.get<WorkingHours[]>('/working-hours', params),

  // Salary (self-forced) — FR-WRK-2
  calculateSalary: (params: SalaryCalcParams) =>
    api.post<SalaryResult>('/salary/calculate', params),

  // Requests — unified create + self list (FR-WRK-3/4/5, FR-WRK)
  createRequest: (body: CreateSelfRequestInput) => api.post<WorkerRequest>('/requests', body),
  listRequests: (params?: { status?: RequestStatus }) =>
    api
      .get<WorkerRequest[] | Paginated<WorkerRequest>>('/requests', params)
      .then(toArray),
};
