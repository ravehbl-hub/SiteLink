/**
 * SiteLink back end — Prisma row → @sitelink/shared DTO mappers.
 *
 * Keeps the DB shape decoupled from the wire contract (Architecture §2): Decimal →
 * number, Date → ISO string, and enum values pass through (they match byte-for-byte
 * between the Prisma enums and the shared enums).
 */
import type {
  AdvancePayment as PAdvance,
  AttendanceRecord as PAttendance,
  Billing as PBilling,
  Company as PCompany,
  Customer as PCustomer,
  Loan as PLoan,
  ProfessionWageRate as PWageRate,
  ProfitLoss as PProfitLoss,
  Site as PSite,
  Usage as PUsage,
  User as PUser,
  Worker as PWorker,
  WorkerDoc as PWorkerDoc,
  WorkerRating as PRating,
  WorkerRequest as PRequest,
  WorkerSalaryData as PSalaryData,
} from '../generated/prisma/client.js';
import type {
  AdvancePayment,
  AttendanceRecord,
  AttendanceType,
  Billing,
  Customer,
  FileRef,
  Language,
  Loan,
  ProfessionWageRate,
  ProfitLoss,
  Profession,
  RateType,
  RequestStatus,
  RequestType,
  Role,
  SalaryCalcMode,
  Site,
  SiteStatus,
  Theme,
  Usage,
  User,
  Worker,
  WorkerDoc,
  WorkerDocType,
  WorkerLevel,
  WorkerRating,
  WorkerRequest,
  WorkerSalaryData,
  BillingStatus,
  Company,
} from '@sitelink/shared';
import { toISO, toISORequired } from './dates.js';
import { toNumber, toNumberOrNull } from './money.js';

export function mapUser(u: PUser): User {
  return {
    id: u.id,
    authUserId: u.authUserId,
    companyId: u.companyId,
    role: u.role as Role,
    fullName: u.fullName,
    email: u.email,
    isLockedOut: u.isLockedOut,
    primarySiteId: u.primarySiteId ?? null,
    language: u.language as Language,
    theme: u.theme as Theme,
    lastLoginAt: toISO(u.lastLoginAt),
    createdAt: toISORequired(u.createdAt),
    updatedAt: toISORequired(u.updatedAt),
  };
}

export function mapCompany(c: PCompany): Company {
  return {
    id: c.id,
    name: c.name,
    customerId: c.customerId ?? null,
    isArchived: c.isArchived,
    archivedAt: toISO(c.archivedAt),
    createdAt: toISORequired(c.createdAt),
    updatedAt: toISORequired(c.updatedAt),
  };
}

export function mapSite(s: PSite): Site {
  return {
    id: s.id,
    name: s.name,
    code: s.code ?? null,
    status: s.status as SiteStatus,
    address: s.address ?? null,
    startedAt: toISO(s.startedAt),
    isArchived: s.isArchived,
    archivedAt: toISO(s.archivedAt),
    createdAt: toISORequired(s.createdAt),
    updatedAt: toISORequired(s.updatedAt),
  };
}

function workerImage(w: PWorker): FileRef | null {
  if (!w.imageStorageKey || !w.imageFileName || !w.imageMimeType) return null;
  return {
    storageKey: w.imageStorageKey,
    fileName: w.imageFileName,
    mimeType: w.imageMimeType,
    uploadedAt: w.imageUploadedAt ? toISORequired(w.imageUploadedAt) : toISORequired(w.updatedAt),
  };
}

export function mapWorker(w: PWorker): Worker {
  return {
    id: w.id,
    userId: w.userId ?? null,
    image: workerImage(w),
    firstName: w.firstName,
    lastName: w.lastName,
    country: w.country ?? null,
    address: w.address ?? null,
    profession: w.profession as Profession,
    level: w.level as WorkerLevel,
    qualityOfWorks: w.qualityOfWorks ?? null,
    phone: w.phone ?? null,
    email: w.email ?? null,
    personnelCompany: w.personnelCompany ?? null,
    personnelCompanyId: w.personnelCompanyId ?? null,
    residence: w.residence ?? null,
    startDate: toISO(w.startDate),
    isArchived: w.isArchived,
    archivedAt: toISO(w.archivedAt),
    createdAt: toISORequired(w.createdAt),
    updatedAt: toISORequired(w.updatedAt),
  };
}

export function mapWorkerDoc(d: PWorkerDoc): WorkerDoc {
  return {
    id: d.id,
    workerId: d.workerId,
    type: d.type as WorkerDocType,
    reference: d.reference ?? null,
    expiresAt: toISO(d.expiresAt),
    file: {
      storageKey: d.storageKey,
      fileName: d.fileName,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes ?? undefined,
      uploadedAt: toISORequired(d.uploadedAt),
    },
    createdAt: toISORequired(d.createdAt),
    updatedAt: toISORequired(d.updatedAt),
  };
}

export function mapSalaryData(s: PSalaryData): WorkerSalaryData {
  return {
    id: s.id,
    workerId: s.workerId,
    hourlyWage: toNumber(s.hourlyWage),
    rateType: s.rateType as RateType,
    workingConditions: s.workingConditions ?? null,
    currency: s.currency,
    createdAt: toISORequired(s.createdAt),
    updatedAt: toISORequired(s.updatedAt),
  };
}

export function mapAttendance(a: PAttendance): AttendanceRecord {
  return {
    id: a.id,
    workerId: a.workerId,
    siteId: a.siteId ?? null,
    date: toISORequired(a.date),
    type: a.type as AttendanceType,
    hours: toNumberOrNull(a.hours),
    notes: a.notes ?? null,
    createdAt: toISORequired(a.createdAt),
    updatedAt: toISORequired(a.updatedAt),
  };
}

export function mapLoan(l: PLoan): Loan {
  return {
    id: l.id,
    workerId: l.workerId,
    amount: toNumber(l.amount),
    currency: l.currency,
    date: toISORequired(l.date),
    notes: l.notes ?? null,
    outstanding: toNumber(l.outstanding),
    createdAt: toISORequired(l.createdAt),
    updatedAt: toISORequired(l.updatedAt),
  };
}

export function mapAdvance(a: PAdvance): AdvancePayment {
  return {
    id: a.id,
    workerId: a.workerId,
    amount: toNumber(a.amount),
    currency: a.currency,
    date: toISORequired(a.date),
    notes: a.notes ?? null,
    outstanding: toNumber(a.outstanding),
    createdAt: toISORequired(a.createdAt),
    updatedAt: toISORequired(a.updatedAt),
  };
}

export function mapWageRate(r: PWageRate): ProfessionWageRate {
  return {
    id: r.id,
    profession: r.profession as Profession,
    wage: toNumber(r.wage),
    rateType: r.rateType as RateType,
    calcMode: r.calcMode as SalaryCalcMode,
    currency: r.currency,
    siteId: r.siteId ?? null,
    createdAt: toISORequired(r.createdAt),
    updatedAt: toISORequired(r.updatedAt),
  };
}

export function mapRequest(r: PRequest): WorkerRequest {
  return {
    id: r.id,
    workerId: r.workerId,
    requestedById: r.requestedById ?? null,
    type: r.type as RequestType,
    status: r.status as RequestStatus,
    amount: toNumberOrNull(r.amount),
    currency: r.currency ?? null,
    startDate: toISO(r.startDate),
    endDate: toISO(r.endDate),
    notes: r.notes ?? null,
    resolvedById: r.resolvedById ?? null,
    resolvedAt: toISO(r.resolvedAt),
    resolutionNotes: r.resolutionNotes ?? null,
    createdAt: toISORequired(r.createdAt),
    updatedAt: toISORequired(r.updatedAt),
  };
}

export function mapRating(r: PRating): WorkerRating {
  return {
    id: r.id,
    workerId: r.workerId,
    foremanId: r.foremanId,
    date: toISORequired(r.date),
    score: r.score,
    notes: r.notes ?? null,
    createdAt: toISORequired(r.createdAt),
    updatedAt: toISORequired(r.updatedAt),
  };
}

// ─── SaaS business layer (Back Office, ADMIN-only) ──────────────────────────

export function mapCustomer(c: PCustomer): Customer {
  return {
    id: c.id,
    name: c.name,
    contactEmail: c.contactEmail ?? null,
    contactPhone: c.contactPhone ?? null,
    registeredAt: toISORequired(c.registeredAt),
    leftAt: toISO(c.leftAt),
    isArchived: c.isArchived,
    archivedAt: toISO(c.archivedAt),
    createdAt: toISORequired(c.createdAt),
    updatedAt: toISORequired(c.updatedAt),
  };
}

export function mapBilling(b: PBilling): Billing {
  return {
    id: b.id,
    customerId: b.customerId,
    status: b.status as BillingStatus,
    plan: b.plan,
    amount: toNumber(b.amount),
    currency: b.currency,
    periodStart: toISORequired(b.periodStart),
    periodEnd: toISORequired(b.periodEnd),
    createdAt: toISORequired(b.createdAt),
    updatedAt: toISORequired(b.updatedAt),
  };
}

export function mapUsage(u: PUsage): Usage {
  return {
    id: u.id,
    customerId: u.customerId,
    metric: u.metric,
    value: toNumber(u.value),
    periodStart: toISORequired(u.periodStart),
    periodEnd: toISORequired(u.periodEnd),
    createdAt: toISORequired(u.createdAt),
    updatedAt: toISORequired(u.updatedAt),
  };
}

export function mapProfitLoss(p: PProfitLoss): ProfitLoss {
  return {
    id: p.id,
    siteId: p.siteId ?? null,
    periodStart: toISORequired(p.periodStart),
    periodEnd: toISORequired(p.periodEnd),
    currency: p.currency,
    revenue: toNumber(p.revenue),
    salaryCost: toNumber(p.salaryCost),
    loansCost: toNumber(p.loansCost),
    advancesCost: toNumber(p.advancesCost),
    otherCost: toNumber(p.otherCost),
    netProfit: toNumber(p.netProfit),
    createdAt: toISORequired(p.createdAt),
    updatedAt: toISORequired(p.updatedAt),
  };
}
