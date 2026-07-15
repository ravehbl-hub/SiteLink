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

/**
 * Aggregation grain for the self working-hours view (FR-WRK-1). Kept lowercase in
 * the UI/i18n layer (Segmented values + `workingHours.grain{Day,Week,Month}` labels).
 * The wire casing differs per route and is applied at each API-call boundary:
 *   - GET /working-hours          expects UPPERCASE  DAY|WEEK|MONTH (attendance schema)
 *   - GET /reports/working-hours.pdf expects lowercase day|week|month  (reports schema
 *     remaps internally). See Backend attendance/schemas.ts + reports/routes.ts.
 */
export type WorkingHoursGrainParam = 'day' | 'week' | 'month';

/** Wire form for the attendance /working-hours query (uppercase enum). */
export type WorkingHoursGrainWire = 'DAY' | 'WEEK' | 'MONTH';

const GRAIN_WIRE: Record<WorkingHoursGrainParam, WorkingHoursGrainWire> = {
  day: 'DAY',
  week: 'WEEK',
  month: 'MONTH',
};

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

  // Working hours (self-scoped; returns the caller's own aggregates) — FR-WRK-1.
  // The attendance schema is z.enum(['DAY','WEEK','MONTH']); map to uppercase on the wire.
  workingHours: (params: WorkingHoursParams) =>
    api.get<WorkingHours[]>('/working-hours', {
      from: params.from,
      to: params.to,
      grain: GRAIN_WIRE[params.grain],
    }),

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
