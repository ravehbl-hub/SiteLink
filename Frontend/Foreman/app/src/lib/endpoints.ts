/**
 * Typed endpoint wrappers over the REST contract (Foreman surface), using
 * @sitelink/shared DTOs. One function per back-end route consumed by this app.
 *
 * Every list/read is scoped to the Foreman's own primarySiteId by the caller
 * (siteId=primarySiteId). The back end additionally FORCES a Foreman's attendance
 * siteId to their own site, and derives foremanId server-side for ratings.
 */
import type {
  AttendanceRecord,
  CreateAttendanceInput,
  CreateWorkerInput,
  CurrentUser,
  DashboardRollup,
  Paginated,
  PickableSite,
  UpdateWorkerInput,
  Worker,
  WorkerWithDetails,
} from '@sitelink/shared';
import { api } from './api';

/**
 * Re-export the shared multi-site picker projection so existing app imports
 * (`import type { PickableSite } from '../lib/endpoints'`) keep resolving. It is
 * `{ siteId, name, isPrimary, status }` and is returned by the SELF-scoped
 * `GET /foreman-sites` — the foreman-facing scope union WITH real site names.
 */
export type { PickableSite };

export interface DashboardParams {
  siteId?: string;
  from?: string;
  to?: string;
}

/**
 * Worker rating (FR-FOR-5). Wire shape mirrors @sitelink/shared
 * createWorkerRatingSchema: { workerId, date, score, notes? }. `workerId` is taken
 * from the path (:id) and `foremanId` is server-derived from the session — neither
 * is sent in the body here; `date` (ISO calendar date) IS required by the schema.
 */
export interface CreateWorkerRatingInput {
  /** ISO calendar date, e.g. "2026-07-13". Required by the shared schema. */
  date: string;
  /** 1–5 (inclusive). */
  score: number;
  notes?: string | null;
}

export interface WorkerRating {
  id: string;
  workerId: string;
  foremanId: string;
  score: number;
  notes?: string | null;
  createdAt: string;
  updatedAt?: string;
}

/** Back-end /worker-count response (per-site headcount summary, FR-FOR-3). */
export interface WorkerCount {
  siteId?: string | null;
  count: number;
}

/**
 * Worker profile image signed-URL flow (symmetric to the Manager app). The back
 * end mints an upload URL, the client PUTs the object to Supabase, then confirms.
 * Shapes mirror backend/src/modules/workers/dto.ts and are now FOREMAN-accessible
 * + site-scoped by the foreman token server-side.
 */
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

export const endpoints = {
  // Auth
  me: () => api.get<CurrentUser>('/auth/me'),

  // Foreman multi-site picker source (FR-FOR multi-site). SELF-scoped: the back end
  // derives the union (primarySiteId + active ForemanSiteAssignment rows) from the
  // session — no foremanId/siteId is sent. FOREMAN-only; empty union → 200 [].
  foremanSites: () => api.get<PickableSite[]>('/foreman-sites'),

  // Dashboard (FR-FOR-2) — always scoped to the Foreman's own site.
  dashboard: (params: DashboardParams) => api.get<DashboardRollup>('/dashboard', params),

  // Workers (own-site only — caller passes siteId=primarySiteId). The back end
  // additionally auto-scopes a FOREMAN caller to their assigned site(s); passing a
  // siteId outside that union → 403.
  listWorkers: (params?: { includeArchived?: boolean; siteId?: string; page?: number; pageSize?: number }) =>
    api.get<Paginated<Worker>>('/workers', params),

  // Worker detail (VIEW). 403 if the worker is not on one of the foreman's sites.
  getWorker: (id: string) => api.get<WorkerWithDetails>(`/workers/${id}`),

  // Create a worker (FOREMAN: siteIds REQUIRED within the foreman's sites; email +
  // password REQUIRED → the worker gets a WORKER login immediately). role is forced
  // to WORKER server-side. 400 validation / 403 scope / 409 duplicate login email.
  createWorker: (body: CreateWorkerInput) => api.post<Worker>('/workers', body),

  // Edit a worker (password NOT resent). siteIds must stay within the foreman's sites.
  updateWorker: (id: string, body: UpdateWorkerInput) =>
    api.patch<Worker>(`/workers/${id}`, body),

  // Attendance (FR-FOR-4). Back end forces a Foreman's siteId to their own site.
  listAttendance: (params: { siteId?: string; workerId?: string; from?: string; to?: string }) =>
    api.get<Paginated<AttendanceRecord>>('/attendance', params),
  createAttendance: (body: CreateAttendanceInput) =>
    api.post<AttendanceRecord>('/attendance', body),
  updateAttendance: (id: string, body: Partial<CreateAttendanceInput>) =>
    api.patch<AttendanceRecord>(`/attendance/${id}`, body),

  // Worker rating (FR-FOR-5). foremanId is server-derived — do NOT send it.
  listWorkerRatings: (workerId: string) =>
    api.get<WorkerRating[]>(`/workers/${workerId}/ratings`),
  createWorkerRating: (workerId: string, body: CreateWorkerRatingInput) =>
    api.post<WorkerRating>(`/workers/${workerId}/ratings`, body),

  // Worker profile image (signed-URL flow, symmetric to the Manager app; the routes
  // are FOREMAN-accessible + site-scoped by the foreman token server-side).
  requestImageUpload: (id: string, body: ImageUploadRequest) =>
    api.post<SignedUploadResponse>(`/workers/${id}/image/upload-url`, body),
  confirmImage: (id: string, body: ConfirmImageRequest) =>
    api.post<Worker>(`/workers/${id}/image`, body),
  getImageReadUrl: (id: string) =>
    api.get<SignedReadResponse>(`/workers/${id}/image/url`),

  // Reports (FR-FOR-3) — worker-count summary for own site.
  workerCount: (params: { siteId?: string }) => api.get<WorkerCount>('/worker-count', params),
};
