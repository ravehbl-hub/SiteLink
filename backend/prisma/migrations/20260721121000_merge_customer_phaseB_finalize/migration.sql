-- Migration: merge_customer_phaseB_finalize
-- Owner: Savant (DB). MERGE the billing `Customer` model INTO `Company` (Option C).
--
-- PHASE B — DESTRUCTIVE / FINALIZE (apply ONLY after Phase A + the backfill script have
-- run AND the backfill verification printed 0 NULL companyId rows AND the NEW backend
-- build is ready to deploy). This phase:
--   1. Enforces companyId NOT NULL on Billing / Usage / BusinessProfitLoss.
--   2. Adds the new companyId → Company foreign keys + swaps the customerId indexes.
--   3. Drops the old customerId columns (+ their FKs/indexes) on those three tables.
--   4. Drops Company.customerId (+ its FK + unique index).
--   5. DROP TABLE "Customer".
--
-- PRECONDITION (fail-loud guard): the SET NOT NULL statements ABORT the whole
-- (transactional) migration if ANY Billing/Usage/PnL row still has a NULL companyId —
-- a built-in guarantee the backfill fully ran. Do NOT apply this until the backfill's
-- "0 NULL companyId" assertion has passed.
--
-- IRREVERSIBLE: this drops the Customer table and the customerId columns. The Phase A
-- rollback no longer applies once this runs. A full JSON backup exists
-- (backend/backups/full-backup-*.json) for disaster recovery.

-- ─── 1. Drop OLD customerId FKs (must go before dropping the referenced Customer) ─
ALTER TABLE "Billing"            DROP CONSTRAINT IF EXISTS "Billing_customerId_fkey";
ALTER TABLE "Usage"              DROP CONSTRAINT IF EXISTS "Usage_customerId_fkey";
ALTER TABLE "BusinessProfitLoss" DROP CONSTRAINT IF EXISTS "BusinessProfitLoss_customerId_fkey";
ALTER TABLE "Company"            DROP CONSTRAINT IF EXISTS "Company_customerId_fkey";

-- ─── 2. Drop OLD customerId indexes ──────────────────────────────────────────────
DROP INDEX IF EXISTS "Billing_customerId_idx";
DROP INDEX IF EXISTS "Usage_customerId_metric_idx";
DROP INDEX IF EXISTS "BusinessProfitLoss_customerId_periodStart_periodEnd_idx";
DROP INDEX IF EXISTS "Company_customerId_key";

-- ─── 3. Enforce companyId NOT NULL (fail-loud orphan guard) ──────────────────────
ALTER TABLE "Billing"            ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "Usage"              ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "BusinessProfitLoss" ALTER COLUMN "companyId" SET NOT NULL;

-- ─── 4. New companyId → Company foreign keys ─────────────────────────────────────
-- All three use ON DELETE RESTRICT — the tenant-owned convention. A Company with any
-- billing history is retired via isArchived soft-archive, never hard-deleted (a Cascade
-- would silently erase billing/usage/PnL ledgers).
ALTER TABLE "Billing" ADD CONSTRAINT "Billing_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Usage" ADD CONSTRAINT "Usage_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BusinessProfitLoss" ADD CONSTRAINT "BusinessProfitLoss_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── 5. New companyId indexes (mirror the schema @@index) ────────────────────────
CREATE INDEX "Billing_companyId_idx" ON "Billing"("companyId");
CREATE INDEX "Usage_companyId_metric_idx" ON "Usage"("companyId", "metric");
CREATE INDEX "BusinessProfitLoss_companyId_periodStart_periodEnd_idx" ON "BusinessProfitLoss"("companyId", "periodStart", "periodEnd");

-- ─── 6. Drop OLD customerId columns ──────────────────────────────────────────────
ALTER TABLE "Billing"            DROP COLUMN "customerId";
ALTER TABLE "Usage"              DROP COLUMN "customerId";
ALTER TABLE "BusinessProfitLoss" DROP COLUMN "customerId";
ALTER TABLE "Company"            DROP COLUMN "customerId";

-- ─── 7. Drop the now-orphaned Customer table ─────────────────────────────────────
-- All billing rows have been reparented to Company; every Customer's data has been
-- migrated (linked → its Company; orphan → a NEW Company). Nothing references Customer.
DROP TABLE "Customer";
