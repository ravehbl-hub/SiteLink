/**
 * @sitelink/shared — Workers, Worker Docs, Worker Salary data (PRD §5.2 FR-MGR-EMP). v1-active.
 */
import type { Archivable, FileRef, ID, ISODate, Timestamped } from './common';
import { Profession, RateType, WorkerDocType, WorkerLevel } from './enums';

/**
 * Worker profile — the "Worker Details" captured by the Worker Wizard (FR-MGR-EMP-2).
 * Removal supports deletion OR move-to-archives via Archivable (FR-MGR-EMP-5/6).
 */
export interface Worker extends Timestamped, Archivable {
  id: ID;
  /** Profile image (upload or camera). Access-controlled file (FR-MGR-EMP-2). */
  image?: FileRef | null;
  firstName: string; // required (FR-MGR-EMP-7)
  lastName: string; // required (FR-MGR-EMP-7)
  country?: string | null;
  address?: string | null;
  profession: Profession; // required (FR-MGR-EMP-7/8)
  level: WorkerLevel; // Weak/Medium/Good/Excellent (FR-MGR-EMP-9)
  /** Free-text "Quality of works" assessment (FR-MGR-EMP-2). */
  qualityOfWorks?: string | null;
  phone?: string | null;
  email?: string | null;
  /** Personnel / staffing company the worker belongs to (FR-MGR-EMP-2). */
  personnelCompany?: string | null;
  /** Residence (FR-MGR-EMP-2). */
  residence?: string | null;
  /** Date of starting work (FR-MGR-EMP-2). */
  startDate?: ISODate | null;
  /**
   * Optional 1:1 link to the User login for this worker (Phase 05 self-scoping).
   * Present when the worker has a provisioned login; null/absent otherwise.
   * Safe join key (never email).
   */
  userId?: ID | null;
}

/**
 * A stored worker document (FR-MGR-EMP-3): Passport/ID, Visa, Height permit, ATTAT.
 * Retains file type and upload timestamp via FileRef.
 */
export interface WorkerDoc extends Timestamped {
  id: ID;
  workerId: ID;
  type: WorkerDocType;
  file: FileRef;
  /** Optional document number / reference. */
  reference?: string | null;
  /** Optional expiry (e.g. for a visa or permit). */
  expiresAt?: ISODate | null;
}

/**
 * Worker Salary data captured in the wizard (FR-MGR-EMP-4).
 * Per-worker wage overrides profession defaults when present.
 */
export interface WorkerSalaryData extends Timestamped {
  id: ID;
  workerId: ID;
  /** Hourly wage for this worker (FR-MGR-EMP-4). */
  hourlyWage: number;
  rateType: RateType;
  /** Free-text working conditions (FR-MGR-EMP-4). */
  workingConditions?: string | null;
  currency: string;
}

/** Full aggregate returned by the Worker Wizard read (Details + Docs + Salary). */
export interface WorkerWithDetails extends Worker {
  docs: WorkerDoc[];
  salaryData?: WorkerSalaryData | null;
  siteIds: ID[];
}

export interface CreateWorkerInput {
  firstName: string;
  lastName: string;
  profession: Profession;
  level: WorkerLevel;
  country?: string | null;
  address?: string | null;
  qualityOfWorks?: string | null;
  phone?: string | null;
  /**
   * REQUIRED for NEW workers (forward-only, Phase 05 Stage C). Every new worker is
   * created WITH a WORKER login provisioned from this email (Supabase identity + app
   * User row, role WORKER, linked via Worker.userId). The 4 legacy login-less workers
   * are NOT backfilled — they keep a null email/userId and are read/edited as-is.
   */
  email: string;
  /**
   * Optional Manager-set initial password. Omit to send a Supabase INVITE email so
   * the worker sets their own password (the default, matching the Users Manager flow).
   */
  password?: string;
  personnelCompany?: string | null;
  residence?: string | null;
  startDate?: ISODate | null;
  siteIds?: ID[];
}

export type UpdateWorkerInput = Partial<CreateWorkerInput>;
