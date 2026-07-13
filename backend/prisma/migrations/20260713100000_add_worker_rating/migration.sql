-- Migration: add_worker_rating
-- Owner: Savant (DB). New table WorkerRating (Foreman worker ratings, PRD FR-FOR-5).
--
-- `score` is a free INTEGER on a 1..5 scale (validated at the service/DTO layer),
-- intentionally NOT the WorkerLevel enum: this is a per-event, averageable
-- time-series signal, distinct from Worker.level (the Manager's static level).
--
-- RLS: every application table carries deny-by-default RLS (see the
-- 20260713000000_enable_rls_defense_in_depth migration). This new table MUST
-- match that posture. The app connects as `postgres` (BYPASSRLS), so ENABLE ROW
-- LEVEL SECURITY here changes nothing for the service, but keeps the
-- direct-Postgres / PostgREST (anon/authenticated) path closed by default.

-- CreateTable
CREATE TABLE "WorkerRating" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "foremanId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "score" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerRating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkerRating_workerId_idx" ON "WorkerRating"("workerId");

-- CreateIndex
CREATE INDEX "WorkerRating_foremanId_idx" ON "WorkerRating"("foremanId");

-- CreateIndex
CREATE INDEX "WorkerRating_workerId_date_idx" ON "WorkerRating"("workerId", "date");

-- AddForeignKey
ALTER TABLE "WorkerRating" ADD CONSTRAINT "WorkerRating_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerRating" ADD CONSTRAINT "WorkerRating_foremanId_fkey" FOREIGN KEY ("foremanId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enable deny-by-default RLS (defense-in-depth; app role `postgres` bypasses RLS).
ALTER TABLE "WorkerRating" ENABLE ROW LEVEL SECURITY;
