/**
 * Typed REST contract bound to @sitelink/shared DTOs (Architecture §3.2).
 * One function per back-end route; all list endpoints return Paginated<T>.
 */
import type {
  AdvancePayment,
  AttendanceRecord,
  CreateAdvanceInput,
  CreateAttendanceInput,
  CreateLoanInput,
  CreateProfessionWageRateInput,
  CreateSiteInput,
  CreateUserInput,
  CreateWorkerInput,
  CurrentUser,
  DashboardRollup,
  Loan,
  Paginated,
  ProfessionWageRate,
  ProfitLoss,
  Site,
  SalaryResult,
  UpdateAdvanceInput,
  UpdateAttendanceInput,
  UpdateLoanInput,
  UpdateProfessionWageRateInput,
  UpdateSiteInput,
  UpdateUserInput,
  UpdateWorkerInput,
  User,
  Worker,
  WorkerRequest,
  WorkerDoc,
  WorkerDocType,
  WorkerSalaryData,
  WorkerWithDetails,
  WorkingHours,
  WorkingHoursGrain,
} from '@sitelink/shared';
import { RequestStatus } from '@sitelink/shared';
import { http, type Query } from './client';

/* ── Auth ─────────────────────────────────────────────────────────────── */
export const authApi = {
  me: () => http.get<CurrentUser>('/auth/me'),
};

/* ── Dashboard ────────────────────────────────────────────────────────── */
export interface DashboardParams {
  siteId?: string;
  from?: string;
  to?: string;
  revenue?: number;
  currency?: string;
}
export const dashboardApi = {
  get: (params: DashboardParams) =>
    http.get<DashboardRollup>('/dashboard', params as Query),
};

/* ── Sites ────────────────────────────────────────────────────────────── */
export const sitesApi = {
  list: (params?: { includeArchived?: boolean; page?: number; pageSize?: number }) =>
    http.get<Paginated<Site>>('/sites', params as Query),
  get: (id: string) => http.get<Site>(`/sites/${id}`),
  create: (body: CreateSiteInput) => http.post<Site>('/sites', body),
  update: (id: string, body: UpdateSiteInput) => http.patch<Site>(`/sites/${id}`, body),
  archive: (id: string) => http.post<Site>(`/sites/${id}/archive`),
  remove: (id: string) => http.del<void>(`/sites/${id}`),
};

/* ── Workers ──────────────────────────────────────────────────────────── */
export const workersApi = {
  list: (params?: {
    includeArchived?: boolean;
    siteId?: string;
    page?: number;
    pageSize?: number;
  }) => http.get<Paginated<Worker>>('/workers', params as Query),
  get: (id: string) => http.get<WorkerWithDetails>(`/workers/${id}`),
  create: (body: CreateWorkerInput) => http.post<WorkerWithDetails>('/workers', body),
  update: (id: string, body: UpdateWorkerInput) =>
    http.patch<WorkerWithDetails>(`/workers/${id}`, body),
  archive: (id: string) => http.post<Worker>(`/workers/${id}/archive`),
  remove: (id: string) => http.del<void>(`/workers/${id}`),
  upsertSalaryData: (
    id: string,
    body: {
      hourlyWage: number;
      rateType: WorkerSalaryData['rateType'];
      workingConditions?: string | null;
      currency: string;
    },
  ) => http.put<WorkerSalaryData>(`/workers/${id}/salary-data`, body),
  // Docs
  listDocs: (id: string) => http.get<WorkerDoc[]>(`/workers/${id}/docs`),
  requestUpload: (
    id: string,
    body: { type: WorkerDocType; fileName: string; mimeType: string; sizeBytes?: number },
  ) => http.post<DocUploadResponse>(`/workers/${id}/docs/upload-url`, body),
  confirmDoc: (
    id: string,
    body: {
      type: WorkerDocType;
      storageKey: string;
      fileName: string;
      mimeType: string;
      sizeBytes?: number;
      reference?: string | null;
      expiresAt?: string | null;
    },
  ) => http.post<WorkerDoc>(`/workers/${id}/docs`, body),
  docReadUrl: (id: string, docId: string) =>
    http.get<DocReadResponse>(`/workers/${id}/docs/${docId}/url`),
  removeDoc: (id: string, docId: string) => http.del<void>(`/workers/${id}/docs/${docId}`),
};

export interface DocUploadResponse {
  storageKey: string;
  uploadUrl: string;
  token: string;
  bucket: string;
}
export interface DocReadResponse {
  url: string;
  expiresInSeconds: number;
}

/* ── Attendance / Working Hours ───────────────────────────────────────── */
export const attendanceApi = {
  list: (params?: {
    workerId?: string;
    siteId?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  }) => http.get<Paginated<AttendanceRecord>>('/attendance', params as Query),
  create: (body: CreateAttendanceInput) =>
    http.post<AttendanceRecord>('/attendance', body),
  update: (id: string, body: UpdateAttendanceInput) =>
    http.patch<AttendanceRecord>(`/attendance/${id}`, body),
  remove: (id: string) => http.del<void>(`/attendance/${id}`),
  workingHours: (params: {
    workerId?: string;
    siteId?: string;
    from: string;
    to: string;
    grain: WorkingHoursGrain;
  }) => http.get<WorkingHours[]>('/working-hours', params as Query),
};

/* ── Finance: loans, advances, P&L ────────────────────────────────────── */
export const financeApi = {
  listLoans: (params?: { workerId?: string; page?: number; pageSize?: number }) =>
    http.get<Paginated<Loan>>('/loans', params as Query),
  createLoan: (body: CreateLoanInput) => http.post<Loan>('/loans', body),
  updateLoan: (id: string, body: UpdateLoanInput) => http.patch<Loan>(`/loans/${id}`, body),
  removeLoan: (id: string) => http.del<void>(`/loans/${id}`),
  listAdvances: (params?: { workerId?: string; page?: number; pageSize?: number }) =>
    http.get<Paginated<AdvancePayment>>('/advances', params as Query),
  createAdvance: (body: CreateAdvanceInput) => http.post<AdvancePayment>('/advances', body),
  updateAdvance: (id: string, body: UpdateAdvanceInput) =>
    http.patch<AdvancePayment>(`/advances/${id}`, body),
  removeAdvance: (id: string) => http.del<void>(`/advances/${id}`),
  profitLoss: (params: {
    siteId?: string;
    from: string;
    to: string;
    revenue?: number;
    currency?: string;
  }) => http.get<ProfitLoss>('/profit-loss', params as Query),
};

/* ── Requests: worker-submission inbox (approve / reject) ─────────────────
 * Worker-initiated LOAN / ADVANCE / VACATION submissions awaiting an
 * ADMIN/MANAGER decision. `approve` triggers back-end side-effects
 * transactionally (VACATION→attendance, LOAN→Loan, ADVANCE→AdvancePayment).
 * Approved records are then MANAGED on the Finance screen. */
export const requestsApi = {
  list: (params?: { status?: RequestStatus; workerId?: string }) =>
    http.get<Paginated<WorkerRequest>>('/requests', params as Query),
  approve: (id: string) => http.patch<WorkerRequest>(`/requests/${id}/approve`),
  reject: (id: string) => http.patch<WorkerRequest>(`/requests/${id}/reject`),
};

/* ── Payment: profession wage rates ───────────────────────────────────── */
export const paymentApi = {
  list: () => http.get<ProfessionWageRate[]>('/wage-rates'),
  create: (body: CreateProfessionWageRateInput) =>
    http.post<ProfessionWageRate>('/wage-rates', body),
  update: (id: string, body: UpdateProfessionWageRateInput) =>
    http.patch<ProfessionWageRate>(`/wage-rates/${id}`, body),
  remove: (id: string) => http.del<void>(`/wage-rates/${id}`),
};

/* ── Salary ───────────────────────────────────────────────────────────── */
export const salaryApi = {
  calculate: (body: {
    workerId: string;
    siteId?: string;
    periodStart: string;
    periodEnd: string;
  }) => http.post<SalaryResult>('/salary/calculate', body),
};

/* ── Users ────────────────────────────────────────────────────────────── */
export const usersApi = {
  list: (params?: { page?: number; pageSize?: number }) =>
    http.get<Paginated<User>>('/users', params as Query),
  get: (id: string) => http.get<User>(`/users/${id}`),
  create: (body: CreateUserInput) => http.post<User>('/users', body),
  update: (id: string, body: UpdateUserInput) => http.patch<User>(`/users/${id}`, body),
  lockout: (id: string, isLockedOut: boolean) =>
    http.post<User>(`/users/${id}/lockout`, { isLockedOut }),
  remove: (id: string) => http.del<void>(`/users/${id}`),
};
