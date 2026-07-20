-- Migration: add_company_multitenancy_phase2
-- Owner: Savant (DB). Multi-tenancy PHASE 2 — DIRECT companyId on every operational,
-- tenant-owned ROOT table. Completes tenant isolation at the DATA layer (Phase 1 added
-- Company + User.companyId). Follows docs/MULTI-TENANCY-SCHEMA.md §2/§3/§4 EXACTLY.
--
-- SCOPE — 9 models gain a DIRECT companyId (User already has it from Phase 1):
--   Worker, Site, AttendanceRecord, WorkerRequest, Loan, AdvancePayment,
--   ProfessionWageRate, PersonnelCompany, ProfitLoss (the SITE-level P&L — NOT
--   BusinessProfitLoss, which keeps its billing customerId link).
-- DERIVED (deliberately NO companyId column): WorkerSalaryData, WorkerDoc, WorkerRating,
--   SiteAssignment, ForemanSiteAssignment — they derive company via Worker/Site; the
--   service layer (Servio) enforces same-company invariants.
--
-- ZERO-ORPHAN, SAFE, ORDERED (per §4 Step B→C→D→E→F), all in ONE transactional migration:
--   1. ADD COLUMN companyId TEXT NULL on all 9 tables (nullable so ALTER succeeds on
--      populated tables — 107 users, 100+ workers, attendance, ledgers).
--   2. BACKFILL in dependency order (User/Site/PersonnelCompany/WageRate first, then
--      Worker via User, then the worker-derived tables, then ProfitLoss via Site).
--      Default Company id = 'cl000000000000000000default' (the REAL Phase-1 default).
--   3. SET NOT NULL on all 9 — this ABORTS the whole (transactional) migration if ANY
--      row is still null: a built-in zero-orphan guard.
--   4. ADD FK ... REFERENCES "Company"(id) ON DELETE RESTRICT (never cascade a tenant).
--   5. CREATE the scope indexes (§2).
--   6. LAST: the uniqueness changes (ProfessionWageRate, PersonnelCompany) — after all
--      rows are in the Default Company so the new composite uniques are guaranteed
--      satisfied (the old single-column uniques held).
--
-- RLS: all 9 tables ALREADY have deny-by-default RLS (20260713000000 + 20260718072757).
-- This migration does NOT disable or re-enable it.
--
-- SANDBOX: applied to live Supabase via `prisma migrate deploy` with the sandbox disabled.

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP B — ADD nullable companyId to all 9 DIRECT models
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE "Worker"             ADD COLUMN "companyId" TEXT;
ALTER TABLE "Site"               ADD COLUMN "companyId" TEXT;
ALTER TABLE "AttendanceRecord"   ADD COLUMN "companyId" TEXT;
ALTER TABLE "WorkerRequest"      ADD COLUMN "companyId" TEXT;
ALTER TABLE "Loan"               ADD COLUMN "companyId" TEXT;
ALTER TABLE "AdvancePayment"     ADD COLUMN "companyId" TEXT;
ALTER TABLE "ProfessionWageRate" ADD COLUMN "companyId" TEXT;
ALTER TABLE "PersonnelCompany"   ADD COLUMN "companyId" TEXT;
ALTER TABLE "ProfitLoss"         ADD COLUMN "companyId" TEXT;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP C — BACKFILL (authoritative source, in dependency order per §4 Step C)
-- ═══════════════════════════════════════════════════════════════════════════════

-- (1) Site → Default Company (existing sites have no owner link today).
UPDATE "Site" SET "companyId" = 'cl000000000000000000default' WHERE "companyId" IS NULL;

-- (2) PersonnelCompany → Default Company.
UPDATE "PersonnelCompany" SET "companyId" = 'cl000000000000000000default' WHERE "companyId" IS NULL;

-- (3) ProfessionWageRate → Default Company.
UPDATE "ProfessionWageRate" SET "companyId" = 'cl000000000000000000default' WHERE "companyId" IS NULL;

-- (4) Worker → User.companyId via userId WHEN the login link exists; ELSE Default Company
--     (login-less legacy + the 100+ demo workers, which have userId = NULL). Every worker
--     ends non-null. NOTE: derives from User (already scoped in Phase 1), never from siteId.
UPDATE "Worker" w
SET "companyId" = COALESCE(
  (SELECT u."companyId" FROM "User" u WHERE u."id" = w."userId"),
  'cl000000000000000000default'
)
WHERE w."companyId" IS NULL;

-- (5) AttendanceRecord → Worker.companyId via workerId (NOT via nullable siteId).
UPDATE "AttendanceRecord" a
SET "companyId" = (SELECT w."companyId" FROM "Worker" w WHERE w."id" = a."workerId")
WHERE a."companyId" IS NULL;

-- (6) WorkerRequest → Worker.companyId via workerId.
UPDATE "WorkerRequest" r
SET "companyId" = (SELECT w."companyId" FROM "Worker" w WHERE w."id" = r."workerId")
WHERE r."companyId" IS NULL;

-- (7) Loan → Worker.companyId via workerId.
UPDATE "Loan" l
SET "companyId" = (SELECT w."companyId" FROM "Worker" w WHERE w."id" = l."workerId")
WHERE l."companyId" IS NULL;

-- (8) AdvancePayment → Worker.companyId via workerId.
UPDATE "AdvancePayment" ap
SET "companyId" = (SELECT w."companyId" FROM "Worker" w WHERE w."id" = ap."workerId")
WHERE ap."companyId" IS NULL;

-- (9) ProfitLoss → Site.companyId via siteId WHEN set; ELSE Default Company
--     (company-wide P&L rows with siteId = NULL).
UPDATE "ProfitLoss" p
SET "companyId" = COALESCE(
  (SELECT s."companyId" FROM "Site" s WHERE s."id" = p."siteId"),
  'cl000000000000000000default'
)
WHERE p."companyId" IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP D+E — Enforce NOT NULL (zero-orphan guard: aborts if any row still null),
--            then add the FK (ON DELETE RESTRICT — never cascade a tenant).
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE "Worker"             ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "Site"               ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "AttendanceRecord"   ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "WorkerRequest"      ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "Loan"               ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "AdvancePayment"     ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "ProfessionWageRate" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "PersonnelCompany"   ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "ProfitLoss"         ALTER COLUMN "companyId" SET NOT NULL;

ALTER TABLE "Worker"             ADD CONSTRAINT "Worker_companyId_fkey"             FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Site"               ADD CONSTRAINT "Site_companyId_fkey"               FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttendanceRecord"   ADD CONSTRAINT "AttendanceRecord_companyId_fkey"   FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkerRequest"      ADD CONSTRAINT "WorkerRequest_companyId_fkey"      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Loan"               ADD CONSTRAINT "Loan_companyId_fkey"               FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdvancePayment"     ADD CONSTRAINT "AdvancePayment_companyId_fkey"     FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProfessionWageRate" ADD CONSTRAINT "ProfessionWageRate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PersonnelCompany"   ADD CONSTRAINT "PersonnelCompany_companyId_fkey"   FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProfitLoss"         ADD CONSTRAINT "ProfitLoss_companyId_fkey"         FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP F(i) — Scope indexes (§2)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE INDEX "Worker_companyId_idx"                ON "Worker"("companyId");
CREATE INDEX "Worker_companyId_isArchived_idx"     ON "Worker"("companyId", "isArchived");
CREATE INDEX "Worker_companyId_profession_idx"     ON "Worker"("companyId", "profession");

CREATE INDEX "Site_companyId_idx"                  ON "Site"("companyId");
CREATE INDEX "Site_companyId_status_idx"           ON "Site"("companyId", "status");
CREATE INDEX "Site_companyId_isArchived_idx"       ON "Site"("companyId", "isArchived");

CREATE INDEX "AttendanceRecord_companyId_date_idx" ON "AttendanceRecord"("companyId", "date");

CREATE INDEX "WorkerRequest_companyId_status_idx"  ON "WorkerRequest"("companyId", "status");
CREATE INDEX "WorkerRequest_companyId_type_idx"    ON "WorkerRequest"("companyId", "type");

CREATE INDEX "Loan_companyId_date_idx"             ON "Loan"("companyId", "date");

CREATE INDEX "AdvancePayment_companyId_date_idx"   ON "AdvancePayment"("companyId", "date");

CREATE INDEX "PersonnelCompany_companyId_isArchived_idx" ON "PersonnelCompany"("companyId", "isArchived");

CREATE INDEX "ProfitLoss_companyId_periodStart_periodEnd_idx" ON "ProfitLoss"("companyId", "periodStart", "periodEnd");

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP F(ii) — Uniqueness changes LAST (after backfill; guaranteed satisfiable
--              since all rows are in the Default Company and the old uniques held).
-- ═══════════════════════════════════════════════════════════════════════════════

-- ProfessionWageRate: replace @@index([profession]) with @@index([companyId, profession]),
-- and @@unique([profession, siteId]) → @@unique([companyId, profession, siteId]).
DROP INDEX "ProfessionWageRate_profession_idx";
CREATE INDEX "ProfessionWageRate_companyId_profession_idx" ON "ProfessionWageRate"("companyId", "profession");

DROP INDEX "ProfessionWageRate_profession_siteId_key";
CREATE UNIQUE INDEX "ProfessionWageRate_companyId_profession_siteId_key" ON "ProfessionWageRate"("companyId", "profession", "siteId");

-- PersonnelCompany: name @unique (global) → @@unique([companyId, name]).
DROP INDEX "PersonnelCompany_name_key";
CREATE UNIQUE INDEX "PersonnelCompany_companyId_name_key" ON "PersonnelCompany"("companyId", "name");
