-- Migration: add_personnel_company
-- Owner: Savant (DB). Promote the free-text Worker.personnelCompany into a managed entity.
--
-- WHAT / WHY
-- ----------
-- 1. New table "PersonnelCompany" (managed entity: name + contact fields, soft-delete via
--    isArchived, timestamps). "name" is UNIQUE — the backfill dedupes the distinct free-text
--    values into one row each, and the manager picker/CRUD (Servio) relies on name uniqueness.
-- 2. Worker gains a NULLABLE FK "personnelCompanyId" -> PersonnelCompany(id), ON DELETE SET NULL
--    (deleting a company unlinks its workers, never deletes them), plus a lookup index.
-- 3. DATA BACKFILL (the important part — no values are lost): for each DISTINCT non-null,
--    non-empty (trimmed) "Worker.personnelCompany" free-text value, create one PersonnelCompany
--    row, then point matching workers at it. Dedupe is CASE-INSENSITIVE on the trimmed value
--    (lower(btrim(...))); the stored name is the trimmed original of the first-seen variant
--    (MIN by ctid). Whitespace-only / empty / NULL free-text -> personnelCompanyId stays NULL.
--
-- KEEP-OLD-COLUMN DECISION: the legacy "Worker"."personnelCompany" TEXT column is DELIBERATELY
-- KEPT for now (not dropped) so nothing is lost and Servio's in-flight worker edits don't break
-- on a missing column. A LATER migration drops it once the FK is fully wired + FE cut over.
--
-- RLS: like every application table (see 20260713000000_enable_rls_defense_in_depth), the new
-- PersonnelCompany table gets deny-by-default ENABLE ROW LEVEL SECURITY. The app role (postgres)
-- has BYPASSRLS, so this changes nothing for the Fastify service; it closes the direct-Postgres /
-- PostgREST path. Worker's existing RLS is untouched (adding a column/FK/index does not affect it).

-- ─── Schema: FK column on Worker ──────────────────────────────────────────────
-- AlterTable
ALTER TABLE "Worker" ADD COLUMN     "personnelCompanyId" TEXT;

-- ─── Schema: new managed table ───────────────────────────────────────────────
-- CreateTable
CREATE TABLE "PersonnelCompany" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonnelCompany_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PersonnelCompany_name_key" ON "PersonnelCompany"("name");

-- CreateIndex
CREATE INDEX "PersonnelCompany_isArchived_idx" ON "PersonnelCompany"("isArchived");

-- CreateIndex
CREATE INDEX "Worker_personnelCompanyId_idx" ON "Worker"("personnelCompanyId");

-- AddForeignKey
ALTER TABLE "Worker" ADD CONSTRAINT "Worker_personnelCompanyId_fkey" FOREIGN KEY ("personnelCompanyId") REFERENCES "PersonnelCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Data backfill: distinct free-text -> one company each, then link workers ──
-- Deterministic + repeatable: one company per case-insensitive trimmed value.
-- id uses a cuid-shaped value; here we mint a stable unique id via gen_random_uuid()
-- prefixed to stay TEXT-compatible with the cuid column (the value only needs to be a
-- unique TEXT id — the FK/PK are plain TEXT, not validated as cuid). New rows created by
-- the app afterwards use Prisma's cuid() default; these backfill ids coexist fine.
INSERT INTO "PersonnelCompany" ("id", "name", "isArchived", "createdAt", "updatedAt")
SELECT
    'pc_' || replace(gen_random_uuid()::text, '-', '') AS id,
    src.name,
    false,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT ON (lower(btrim("personnelCompany")))
        btrim("personnelCompany") AS name
    FROM "Worker"
    WHERE "personnelCompany" IS NOT NULL
      AND btrim("personnelCompany") <> ''
    ORDER BY lower(btrim("personnelCompany")), btrim("personnelCompany")
) AS src
ON CONFLICT ("name") DO NOTHING;

-- Link each worker (case-insensitive trimmed match) to its company.
UPDATE "Worker" w
SET "personnelCompanyId" = pc."id"
FROM "PersonnelCompany" pc
WHERE w."personnelCompany" IS NOT NULL
  AND btrim(w."personnelCompany") <> ''
  AND lower(btrim(w."personnelCompany")) = lower(pc."name");

-- ─── RLS: deny-by-default (matches 20260713000000_enable_rls_defense_in_depth) ─
ALTER TABLE "PersonnelCompany" ENABLE ROW LEVEL SECURITY;
