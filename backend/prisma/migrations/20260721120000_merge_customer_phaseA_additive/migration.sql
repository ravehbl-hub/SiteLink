-- Migration: merge_customer_phaseA_additive
-- Owner: Savant (DB). MERGE the billing `Customer` model INTO `Company` (Option C).
--
-- PHASE A — ADDITIVE ONLY (reversible, safe to apply while the old backend still runs).
-- ==================================================================================
-- This phase adds the NEW nullable columns needed by the merge but drops NOTHING and
-- adds NO NOT-NULL / FK constraints yet. After this applies, the parent runs the
-- backfill script (backend/scripts/merge-customer-backfill.ts) to populate companyId
-- on Billing/Usage/BusinessProfitLoss and copy the Customer contact/lifecycle fields
-- onto Company (creating a new Company per orphan Customer). Phase B then finalizes
-- (SET NOT NULL + FKs, drop the customerId columns, DROP TABLE "Customer").
--
-- SAFETY: every statement is IF NOT EXISTS / additive, so a re-apply is idempotent and
-- the OLD backend (which still reads/writes customerId) keeps working unchanged.
--
-- ─── Company: billing contact + lifecycle columns (moved from Customer) ──────────
-- registeredAt gets a DEFAULT now() so existing Company rows are valid immediately;
-- the backfill later overwrites it from the linked Customer where applicable.
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "contactEmail" TEXT;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "contactPhone" TEXT;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "leftAt" TIMESTAMP(3);

-- ─── Billing / Usage / BusinessProfitLoss: nullable companyId (backfilled next) ──
ALTER TABLE "Billing"            ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "Usage"              ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "BusinessProfitLoss" ADD COLUMN IF NOT EXISTS "companyId" TEXT;

-- ==================================================================================
-- ROLLBACK (Phase A) — exact reverse SQL. Run ONLY before Phase B has been applied
-- (after Phase B these columns are load-bearing). Safe because nothing was dropped and
-- no constraints were added; the OLD backend never read these columns.
-- ----------------------------------------------------------------------------------
--   ALTER TABLE "BusinessProfitLoss" DROP COLUMN IF EXISTS "companyId";
--   ALTER TABLE "Usage"              DROP COLUMN IF EXISTS "companyId";
--   ALTER TABLE "Billing"            DROP COLUMN IF EXISTS "companyId";
--   ALTER TABLE "Company" DROP COLUMN IF EXISTS "leftAt";
--   ALTER TABLE "Company" DROP COLUMN IF EXISTS "registeredAt";
--   ALTER TABLE "Company" DROP COLUMN IF EXISTS "contactPhone";
--   ALTER TABLE "Company" DROP COLUMN IF EXISTS "contactEmail";
-- ==================================================================================
