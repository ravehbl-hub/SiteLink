-- Migration: add_company_multitenancy_phase1
-- Owner: Savant (DB). Multi-tenancy PHASE 1 — the app's biggest security boundary.
--
-- WHAT / WHY (per docs/MULTI-TENANCY-DECISIONS.md — AUTHORITATIVE)
-- ---------------------------------------------------------------
-- 1. NEW "Company" table — the TENANT (Company -> Manager/Foreman/Worker users). A Manager
--    sees ONLY same-company data; ADMIN is super-admin above all companies. This is a NEW
--    model linked 1:1 to the billing "Customer" (DECISION 1: NOT a rename) — keeping the
--    authz boundary DECOUPLED from the nullable/optional billing model.
--      * customerId TEXT UNIQUE, nullable — enforces AT-MOST-1:1 (DECISION 5). ON DELETE
--        SET NULL: deleting a billing Customer UNLINKS the tenant, never nukes the Company.
--      * isArchived/archivedAt — a tenant is retired by SOFT-ARCHIVE, never cascade-delete.
-- 2. "User".companyId — the DIRECT tenant scope on every user (Phase 1: ONLY User carries
--    companyId; Worker/Site/etc. are Phase 2 and are deliberately UNTOUCHED here).
--    ON DELETE RESTRICT: a Company with users can never be hard-deleted (retire via archive).
-- 3. ZERO-ORPHAN BACKFILL (the critical part): add companyId NULLABLE → INSERT one stable
--    "Default Company" → UPDATE every existing User to it → verify ZERO nulls → SET NOT NULL.
--    All in THIS migration so the FINAL DB state is NOT NULL with no orphans.
-- 4. RLS: like every application table (see 20260713000000_enable_rls_defense_in_depth), the
--    new "Company" table gets deny-by-default ENABLE ROW LEVEL SECURITY. The app role
--    (postgres) has BYPASSRLS so the Fastify service is unaffected; this closes the
--    direct-Postgres / PostgREST path. RLS is defense-in-depth, NOT authorization-in-DB —
--    Fastify remains the single authz boundary.
--
-- SAFETY / RE-RUNNABILITY: the Default Company uses a STABLE, deterministic literal id so a
-- re-apply is idempotent (ON CONFLICT DO NOTHING); the backfill UPDATE is guarded by
-- "companyId IS NULL". The final ALTER ... SET NOT NULL will FAIL LOUDLY (aborting the whole
-- transactional migration) if any User were left with a null companyId — a built-in orphan guard.

-- ─── Schema: new Company (tenant) table ──────────────────────────────────────
-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customerId" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_customerId_key" ON "Company"("customerId");

-- CreateIndex
CREATE INDEX "Company_isArchived_idx" ON "Company"("isArchived");

-- AddForeignKey (Company -> Customer, 1:1, ON DELETE SET NULL — never cascade)
ALTER TABLE "Company" ADD CONSTRAINT "Company_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Schema: User.companyId — add NULLABLE FIRST (for the backfill) ───────────
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "companyId" TEXT;

-- ─── Data backfill: Default Company, then every existing User -> it ───────────
-- (a) One stable "Default Company" (deterministic literal id -> idempotent re-apply).
--     customerId left NULL (simplest; the default tenant has no billing Customer).
INSERT INTO "Company" ("id", "name", "customerId", "isArchived", "createdAt", "updatedAt")
VALUES ('cl000000000000000000default', 'Default Company', NULL, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- (b) Backfill EVERY existing User (100+ demo users + all real users) to the Default Company.
UPDATE "User" SET "companyId" = 'cl000000000000000000default' WHERE "companyId" IS NULL;

-- ─── Orphan guard + finalize: NOT NULL + FK + indexes ────────────────────────
-- (c) SET NOT NULL. This ABORTS the migration (transactional) if ANY User is still null —
--     an explicit zero-orphan guarantee baked into the migration itself.
ALTER TABLE "User" ALTER COLUMN "companyId" SET NOT NULL;

-- AddForeignKey (User -> Company, ON DELETE RESTRICT — never cascade a tenant delete)
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex (scope + role-visibility hot paths)
CREATE INDEX "User_companyId_idx" ON "User"("companyId");

-- CreateIndex
CREATE INDEX "User_companyId_role_idx" ON "User"("companyId", "role");

-- ─── RLS: deny-by-default (matches 20260713000000_enable_rls_defense_in_depth) ─
ALTER TABLE "Company" ENABLE ROW LEVEL SECURITY;
