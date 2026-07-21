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
  CreatePersonnelCompanyInput,
  Paginated,
  PersonnelCompany,
  ProfessionWageRate,
  ProfitLoss,
  Site,
  SalaryResult,
  UpdateAdvanceInput,
  UpdateAttendanceInput,
  UpdateLoanInput,
  UpdatePersonnelCompanyInput,
  UpdateProfessionWageRateInput,
  UpdateSiteInput,
  UpdateUserInput,
  UpdateWorkerInput,
  User,
  ForemanSiteAssignment,
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
/**
 * Worker create/update wire body. Extends the shared DTO with the transitional
 * `personnelCompanyId` FK (the manager FE is cut over to the PersonnelCompany
 * PICKER; the legacy free-text `personnelCompany` on the shared DTO is no longer
 * written by this app). Kept as a local intersection so the picker can send the id
 * without waiting on a shared-package bump.
 */
export type CreateWorkerBody = CreateWorkerInput & { personnelCompanyId?: string | null };
export type UpdateWorkerBody = UpdateWorkerInput & { personnelCompanyId?: string | null };

/**
 * Worker read aggregate as returned by the API, augmented with the transitional
 * `personnelCompanyId` FK so the edit form can pre-select the picker. Optional
 * because the legacy read path may only carry the free-text `personnelCompany`
 * (we fall back to matching by name in that case).
 */
export type WorkerDetailsWithCompany = WorkerWithDetails & {
  personnelCompanyId?: string | null;
};

export const workersApi = {
  list: (params?: {
    includeArchived?: boolean;
    archivedOnly?: boolean;
    siteId?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }) => http.get<Paginated<Worker>>('/workers', params as Query),
  get: (id: string) => http.get<WorkerDetailsWithCompany>(`/workers/${id}`),
  create: (body: CreateWorkerBody) => http.post<WorkerDetailsWithCompany>('/workers', body),
  update: (id: string, body: UpdateWorkerBody) =>
    http.patch<WorkerDetailsWithCompany>(`/workers/${id}`, body),
  archive: (id: string) => http.post<Worker>(`/workers/${id}/archive`),
  unarchive: (id: string) => http.post<Worker>(`/workers/${id}/unarchive`),
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

/* ── Employee mobility (site transfer) ────────────────────────────────────
 * Move a worker to another site: ADDS the destination assignment (existing sites
 * kept) and re-points the effective-day presence (attendance) record to it, creating
 * an ATTENDANCE record on that day if the worker has none. ADMIN/MANAGER-gated,
 * company-scoped server-side. Local types (no shared-package bump needed). */
export interface MobilityTransferBody {
  workerId: string;
  toSiteId: string;
  /** Effective date (ISO). The presence record for this worker/day is re-pointed. */
  date: string;
  fromSiteId?: string | null;
  notes?: string | null;
}
export interface MobilityTransferResult {
  workerId: string;
  toSiteId: string;
  attendance: AttendanceRecord;
  presenceCreated: boolean;
}
export const mobilityApi = {
  transfer: (body: MobilityTransferBody) =>
    http.post<MobilityTransferResult>('/mobility/transfer', body),
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
  /**
   * RE-DECIDE an already-RESOLVED request (ADMIN/MANAGER only). Flips APPROVED↔REJECTED
   * and reverses/re-applies the loan/advance/vacation side effect atomically server-side.
   */
  redecide: (
    id: string,
    body: { status: RequestStatus.APPROVED | RequestStatus.REJECTED; resolutionNotes?: string | null },
  ) => http.patch<WorkerRequest>(`/requests/${id}/redecide`, body),
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
    // HOURS-SPLIT (request-time only, never persisted). When splitEnabled the
    // backend REQUIRES contractorRate (400 otherwise). Omit all three for the
    // default flat/hourly calc.
    splitEnabled?: boolean;
    splitThreshold?: number;
    contractorRate?: number;
  }) => http.post<SalaryResult>('/salary/calculate', body),
};

/* ── Payslip sharing (MANAGER-only, worker-scoped) ────────────────────────
 * Both take the same period the salary screen already computed (from/to are
 * ISO datetimes) plus an optional siteId and a lang for the rendered PDF.
 * - email    → server emails the payslip PDF to the WORKER'S OWN stored email.
 * - whatsapp → server returns a SIGNED PDF link (~30min TTL); the FE then opens
 *   WhatsApp with that link in the message text (WhatsApp can't attach files). */
export interface PayslipShareBody {
  workerId: string;
  from: string;
  to: string;
  siteId?: string;
  lang?: 'he' | 'en' | 'tr';
  /** Include money columns in the rendered payslip PDF. Default false =
   *  hours-only (no prices). Matches the back-end `includePrices` param. */
  includePrices?: boolean;
}
export interface PayslipEmailResult {
  sent: boolean;
  to: string;
}
export interface PayslipWhatsappLink {
  phone: string;
  url: string;
  expiresInSeconds: number;
}
export const payslipApi = {
  email: (body: PayslipShareBody) =>
    http.post<PayslipEmailResult>('/reports/payslip/email', body),
  whatsappLink: (body: PayslipShareBody) =>
    http.post<PayslipWhatsappLink>('/reports/payslip/whatsapp-link', body),
};

/* ── Personnel companies (FR-MGR-EMP-2): org-wide staffing companies ─────
 * ADMIN/MANAGER only. Duplicate name → 409; archive/unarchive toggles state. */
export const personnelCompaniesApi = {
  list: (params?: { includeArchived?: boolean; page?: number; pageSize?: number }) =>
    http.get<Paginated<PersonnelCompany>>('/personnel-companies', params as Query),
  get: (id: string) => http.get<PersonnelCompany>(`/personnel-companies/${id}`),
  create: (body: CreatePersonnelCompanyInput) =>
    http.post<PersonnelCompany>('/personnel-companies', body),
  update: (id: string, body: UpdatePersonnelCompanyInput) =>
    http.patch<PersonnelCompany>(`/personnel-companies/${id}`, body),
  archive: (id: string) => http.post<PersonnelCompany>(`/personnel-companies/${id}/archive`),
  unarchive: (id: string) =>
    http.post<PersonnelCompany>(`/personnel-companies/${id}/unarchive`),
  // Hard delete (MANAGER-only, 204). Workers referencing this company have their
  // personnelCompanyId auto-nulled server-side (FK onDelete:SetNull) — safe, no block.
  remove: (id: string) => http.del<void>(`/personnel-companies/${id}`),
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

/* ── Foreman ⇄ Site assignments (multi-site FOREMAN scope) ────────────────
 * A FOREMAN's full scope = User.primarySiteId (default) + the ACTIVE assignments
 * below. MANAGER/ADMIN gated server-side; the api client attaches the token.
 * POST reactivates a previously-unassigned pair (idempotent on an active pair);
 * DELETE is a soft unassign (sets unassignedAt). See @sitelink/shared. */
export const foremanAssignmentsApi = {
  list: (foremanId: string) =>
    http.get<ForemanSiteAssignment[]>('/foreman-assignments', { foremanId }),
  assign: (foremanId: string, siteId: string) =>
    http.post<ForemanSiteAssignment>('/foreman-assignments', { foremanId, siteId }),
  unassign: (foremanId: string, siteId: string) =>
    http.del<void>('/foreman-assignments', { foremanId, siteId }),
};
