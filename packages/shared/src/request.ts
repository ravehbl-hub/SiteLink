/**
 * @sitelink/shared — Request–Approval workflow (PRD §10a FR-REQ).
 * MODELED for data completeness; the Worker-initiated flow and Admin approval UI
 * are v2 (FR-REQ-3). Modeling now avoids future migration churn (PRD R-5).
 */
import type { ID, ISODate, Timestamped } from './common';
import { RequestStatus, RequestType } from './enums';

/**
 * A worker-initiated request (vacation / loan / advance) with a status lifecycle
 * pending → approved | rejected (FR-REQ-1). Resolution updates the corresponding
 * worker record (FR-REQ-2) once the workflow ships.
 */
export interface WorkerRequest extends Timestamped {
  id: ID;
  workerId: ID;
  /** The user who submitted the request (a Worker user in v2). */
  requestedById?: ID | null;
  type: RequestType;
  status: RequestStatus;
  /** Amount for LOAN / ADVANCE requests. */
  amount?: number | null;
  currency?: string | null;
  /** Date range for VACATION requests. */
  startDate?: ISODate | null;
  endDate?: ISODate | null;
  notes?: string | null;
  /** The Admin/Manager who resolved the request. */
  resolvedById?: ID | null;
  resolvedAt?: ISODate | null;
  resolutionNotes?: string | null;
}

export interface CreateRequestInput {
  workerId: ID;
  type: RequestType;
  amount?: number | null;
  currency?: string | null;
  startDate?: ISODate | null;
  endDate?: ISODate | null;
  notes?: string | null;
}

export interface ResolveRequestInput {
  status: RequestStatus.APPROVED | RequestStatus.REJECTED;
  resolutionNotes?: string | null;
}
