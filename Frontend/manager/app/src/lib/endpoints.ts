/**
 * Typed endpoint wrappers over the REST contract, using @sitelink/shared DTOs.
 * One function per back-end route (backend/src/modules/*). These are the single
 * source of API-shape truth for the screens + React Query hooks.
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
  RequestStatus,
  SalaryResult,
  Site,
  UpdateSiteInput,
  UpdateUserInput,
  UpdateWorkerInput,
  User,
  Worker,
  WorkerDoc,
  WorkerDocType,
  WorkerRequest,
  WorkerSalaryData,
  WorkerWithDetails,
  WorkingHours,
} from '@sitelink/shared';
import { api } from './api';

/**
 * Unwrap a list response that may arrive as a bare array or a `Paginated`
 * envelope. Consume this (or `.items`) rather than `.map`-ing the envelope.
 */
export function toArray<T>(res: T[] | Paginated<T>): T[] {
  return Array.isArray(res) ? res : res.items;
}

/** Back-end signed-URL response shapes (backend/src/modules/workers/dto.ts). */
export interface SignedUploadResponse {
  storageKey: string;
  uploadUrl: string;
  token: string;
  bucket: string;
}
export interface SignedReadResponse {
  url: string;
  expiresInSeconds: number;
}

export interface DashboardParams {
  siteId?: string;
  from?: string;
  to?: string;
  revenue?: number;
  currency?: string;
}

export interface SalaryCalcParams {
  workerId: string;
  siteId?: string;
  periodStart: string;
  periodEnd: string;
}

export interface DocUploadRequest {
  type: WorkerDocType;
  fileName: string;
  mimeType: string;
  sizeBytes?: number;
}

export interface ImageUploadRequest {
  fileName: string;
  mimeType: string;
  sizeBytes?: number;
}

export interface ConfirmImageRequest {
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes?: number;
}

export interface ConfirmDocRequest {
  type: WorkerDocType;
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes?: number;
  reference?: string | null;
  expiresAt?: string | null;
}

export interface WorkerSalaryDataInput {
  hourlyWage: number;
  rateType: WorkerSalaryData['rateType'];
  workingConditions?: string | null;
  currency: string;
}

export const endpoints = {
  // Auth
  me: () => api.get<CurrentUser>('/auth/me'),

  // Dashboard
  dashboard: (params: DashboardParams) => api.get<DashboardRollup>('/dashboard', params),

  // Sites
  listSites: (includeArchived = false) =>
    api.get<Paginated<Site>>('/sites', { includeArchived }),
  getSite: (id: string) => api.get<Site>(`/sites/${id}`),
  createSite: (body: CreateSiteInput) => api.post<Site>('/sites', body),
  updateSite: (id: string, body: UpdateSiteInput) => api.patch<Site>(`/sites/${id}`, body),
  archiveSite: (id: string) => api.post<Site>(`/sites/${id}/archive`),
  removeSite: (id: string) => api.del<void>(`/sites/${id}`),

  // Workers
  listWorkers: (params?: { includeArchived?: boolean; siteId?: string }) =>
    api.get<Paginated<Worker>>('/workers', params),
  getWorker: (id: string) => api.get<WorkerWithDetails>(`/workers/${id}`),
  createWorker: (body: CreateWorkerInput) => api.post<Worker>('/workers', body),
  updateWorker: (id: string, body: UpdateWorkerInput) => api.patch<Worker>(`/workers/${id}`, body),
  archiveWorker: (id: string) => api.post<Worker>(`/workers/${id}/archive`),
  removeWorker: (id: string) => api.del<void>(`/workers/${id}`),
  upsertWorkerSalary: (id: string, body: WorkerSalaryDataInput) =>
    api.put<WorkerSalaryData>(`/workers/${id}/salary-data`, body),

  // Worker docs (signed-URL flow, Architecture §7a)
  listDocs: (id: string) => api.get<WorkerDoc[]>(`/workers/${id}/docs`),
  requestDocUpload: (id: string, body: DocUploadRequest) =>
    api.post<SignedUploadResponse>(`/workers/${id}/docs/upload-url`, body),
  confirmDoc: (id: string, body: ConfirmDocRequest) =>
    api.post<WorkerDoc>(`/workers/${id}/docs`, body),
  getDocReadUrl: (id: string, docId: string) =>
    api.get<SignedReadResponse>(`/workers/${id}/docs/${docId}/url`),
  removeDoc: (id: string, docId: string) => api.del<void>(`/workers/${id}/docs/${docId}`),

  // Worker profile image (signed-URL flow, symmetric to docs)
  requestImageUpload: (id: string, body: ImageUploadRequest) =>
    api.post<SignedUploadResponse>(`/workers/${id}/image/upload-url`, body),
  confirmImage: (id: string, body: ConfirmImageRequest) =>
    api.post<Worker>(`/workers/${id}/image`, body),
  getImageReadUrl: (id: string) =>
    api.get<SignedReadResponse>(`/workers/${id}/image/url`),

  // Attendance + working hours
  listAttendance: (params: { siteId?: string; workerId?: string; from?: string; to?: string }) =>
    api.get<Paginated<AttendanceRecord>>('/attendance', params),
  createAttendance: (body: CreateAttendanceInput) =>
    api.post<AttendanceRecord>('/attendance', body),
  updateAttendance: (id: string, body: Partial<CreateAttendanceInput>) =>
    api.patch<AttendanceRecord>(`/attendance/${id}`, body),
  removeAttendance: (id: string) => api.del<void>(`/attendance/${id}`),
  workingHours: (params: {
    workerId?: string;
    siteId?: string;
    grain?: string;
    from?: string;
    to?: string;
  }) => api.get<WorkingHours[]>('/working-hours', params),

  // Salary
  calculateSalary: (params: SalaryCalcParams) => api.post<SalaryResult>('/salary/calculate', params),

  // Payment / wage rates
  listWageRates: () => api.get<ProfessionWageRate[]>('/wage-rates'),
  createWageRate: (body: CreateProfessionWageRateInput) =>
    api.post<ProfessionWageRate>('/wage-rates', body),
  updateWageRate: (id: string, body: Partial<CreateProfessionWageRateInput>) =>
    api.patch<ProfessionWageRate>(`/wage-rates/${id}`, body),
  removeWageRate: (id: string) => api.del<void>(`/wage-rates/${id}`),

  // Finance
  listLoans: (params?: { workerId?: string }) => api.get<Paginated<Loan>>('/loans', params),
  createLoan: (body: CreateLoanInput) => api.post<Loan>('/loans', body),
  removeLoan: (id: string) => api.del<void>(`/loans/${id}`),
  listAdvances: (params?: { workerId?: string }) => api.get<Paginated<AdvancePayment>>('/advances', params),
  createAdvance: (body: CreateAdvanceInput) => api.post<AdvancePayment>('/advances', body),
  removeAdvance: (id: string) => api.del<void>(`/advances/${id}`),
  profitLoss: (params: { siteId?: string; from?: string; to?: string }) =>
    api.get<ProfitLoss>('/profit-loss', params),

  // Requests — worker-submission inbox (FR-REQ). Manager LISTS all in-scope and
  // resolves; response may be a bare array or Paginated envelope (unwrap with
  // toArray). approve/reject are ADMIN/MANAGER-only PATCH transitions.
  listRequests: (params?: { status?: RequestStatus; workerId?: string }) =>
    api.get<WorkerRequest[] | Paginated<WorkerRequest>>('/requests', params).then(toArray),
  approveRequest: (id: string) => api.patch<WorkerRequest>(`/requests/${id}/approve`),
  rejectRequest: (id: string) => api.patch<WorkerRequest>(`/requests/${id}/reject`),

  // Users
  listUsers: () => api.get<Paginated<User>>('/users'),
  createUser: (body: CreateUserInput) => api.post<User>('/users', body),
  updateUser: (id: string, body: UpdateUserInput) => api.patch<User>(`/users/${id}`, body),
  lockoutUser: (id: string, locked: boolean) =>
    api.post<User>(`/users/${id}/lockout`, { isLockedOut: locked }),
  removeUser: (id: string) => api.del<void>(`/users/${id}`),
};
