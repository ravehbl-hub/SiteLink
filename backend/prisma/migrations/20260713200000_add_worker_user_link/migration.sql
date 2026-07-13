-- Migration: add_worker_user_link
-- Owner: Savant (DB). Safe 1:1 link from a WORKER's User login to their Worker row
-- (Phase 05 self-scoping). Replaces the unsafe Worker.email (nullable + non-unique)
-- as the join key.
--
-- The new "userId" column is:
--   - NULLABLE  — existing workers have no login; linking is optional per create flow.
--   - UNIQUE    — one login ↔ one worker (a safe 1:1 join, never email).
-- FK to "User"(id) ON DELETE SET NULL: deleting the login unlinks the worker record
-- rather than deleting it.
--
-- RLS: Worker already has deny-by-default RLS from the
-- 20260713000000_enable_rls_defense_in_depth migration. Adding a column does NOT
-- change RLS, so it is intentionally NOT re-enabled here.

-- AlterTable
ALTER TABLE "Worker" ADD COLUMN "userId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Worker_userId_key" ON "Worker"("userId");

-- AddForeignKey
ALTER TABLE "Worker" ADD CONSTRAINT "Worker_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
