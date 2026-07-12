/**
 * @sitelink/shared — Domain enums
 *
 * SINGLE SOURCE OF TRUTH for all controlled vocabularies.
 * Convention: enum VALUES are SCREAMING_SNAKE_CASE and MUST match, byte-for-byte,
 * the Prisma enum members in backend/prisma/schema.prisma and the tables in docs/SCHEMA.md.
 *
 * The only intentional exception is SalaryCalcMode's *wire form* used by the
 * SalaryRuleEngine DTOs: the PRD FR-MGR-SRE contract fixes the string literals
 * `'israeli-labor-law' | 'fixed'`. Those literals are defined in ./salary.ts as
 * `SalaryMode`, with an explicit mapping to/from this persisted enum below.
 */

/** User roles. RBAC is enforced server-side against this set. */
export enum Role {
  ADMIN = 'ADMIN',
  MANAGER = 'MANAGER',
  PARTNER = 'PARTNER',
  FOREMAN = 'FOREMAN',
  WORKER = 'WORKER',
}

/** Controlled profession list (PRD FR-MGR-EMP-8). */
export enum Profession {
  IRONWORKER = 'IRONWORKER',
  MOLDER = 'MOLDER',
  CONCRETE_WORKER = 'CONCRETE_WORKER',
  GENERAL_LABORER = 'GENERAL_LABORER',
  FOREMAN = 'FOREMAN',
  MECHANIC = 'MECHANIC',
  ELECTRICIAN = 'ELECTRICIAN',
  PLUMBER = 'PLUMBER',
  OTHER = 'OTHER',
}

/** Worker skill/quality level (PRD FR-MGR-EMP-9). */
export enum WorkerLevel {
  WEAK = 'WEAK',
  MEDIUM = 'MEDIUM',
  GOOD = 'GOOD',
  EXCELLENT = 'EXCELLENT',
}

/**
 * Exclusive per-worker-per-day attendance state (PRD FR-MGR-ATT-4).
 * Exactly one of these applies to a worker on a given date.
 */
export enum AttendanceType {
  ATTENDANCE = 'ATTENDANCE',
  VACATION = 'VACATION',
  DISEASE = 'DISEASE',
}

/** Kind of worker document (PRD FR-MGR-EMP-3). */
export enum WorkerDocType {
  PASSPORT_ID = 'PASSPORT_ID',
  VISA = 'VISA',
  HEIGHT_PERMIT = 'HEIGHT_PERMIT',
  ATTAT = 'ATTAT',
}

/** Salary calculation mode as persisted (PRD FR-MGR-PAY-2). */
export enum SalaryCalcMode {
  ISRAELI_LABOR_LAW = 'ISRAELI_LABOR_LAW',
  FIXED = 'FIXED',
}

/** Wage rate basis for a per-worker or per-profession wage. */
export enum RateType {
  HOURLY = 'HOURLY',
  MONTHLY = 'MONTHLY',
}

/** Construction-site lifecycle status (PRD FR-MGR-SITE-2). */
export enum SiteStatus {
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
}

/** Worker-initiated request type (PRD §10a FR-REQ — modeled, not surfaced in v1). */
export enum RequestType {
  VACATION = 'VACATION',
  LOAN = 'LOAN',
  ADVANCE = 'ADVANCE',
}

/** Request approval status (PRD FR-REQ-1). */
export enum RequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

/** UI language (PRD FR-X-I18N-1). Persisted per user. */
export enum Language {
  HE = 'HE',
  EN = 'EN',
  TR = 'TR',
}

/** UI theme (PRD FR-X-THEME-1). Persisted per user. */
export enum Theme {
  LIGHT = 'LIGHT',
  DARK = 'DARK',
}

/** Billing lifecycle for a SaaS customer (future / FR-BO). */
export enum BillingStatus {
  TRIALING = 'TRIALING',
  ACTIVE = 'ACTIVE',
  PAST_DUE = 'PAST_DUE',
  CANCELED = 'CANCELED',
}
