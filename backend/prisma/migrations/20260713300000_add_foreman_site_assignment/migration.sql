-- Migration: add_foreman_site_assignment
-- Owner: Savant (DB). New table ForemanSiteAssignment — multi-site scope for a FOREMAN
-- user (security-boundary change). Mirrors SiteAssignment (worker⇄site) in shape and
-- semantics: an ACTIVE assignment has "unassignedAt" = NULL; re-assigning an existing
-- (foremanId, siteId) pair REACTIVATES the same row rather than inserting a duplicate,
-- enforced by the UNIQUE(foremanId, siteId) below.
--
-- User.primarySiteId is KEPT as the foreman's DEFAULT/primary site. These rows are the
-- foreman's ASSIGNED scope set; the scope-union logic (primarySiteId + assignments) is
-- Servio's (scope.ts) and is intentionally NOT part of this migration.
--
-- FK ON DELETE:
--   - siteId    -> Site(id)  ON DELETE CASCADE : matches SiteAssignment_siteId_fkey —
--                 deleting a site removes its assignment rows (pure join rows, no
--                 downstream data).
--   - foremanId -> User(id)  ON DELETE CASCADE : matches SiteAssignment_workerId_fkey
--                 (link-table posture). A ForemanSiteAssignment holds NO authored data
--                 (unlike WorkerRating, whose foreman FK is RESTRICT to protect authored
--                 rows), so cascading the pure scope row on user deletion is correct.
--
-- RLS: every application table carries deny-by-default RLS (see
-- 20260713000000_enable_rls_defense_in_depth). This new table MUST match that posture.
-- The app connects as `postgres` (BYPASSRLS), so ENABLE ROW LEVEL SECURITY here changes
-- nothing for the service, but keeps the direct-Postgres / PostgREST (anon/authenticated)
-- path closed by default.

-- CreateTable
CREATE TABLE "ForemanSiteAssignment" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "foremanId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassignedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForemanSiteAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ForemanSiteAssignment_foremanId_idx" ON "ForemanSiteAssignment"("foremanId");

-- CreateIndex
CREATE INDEX "ForemanSiteAssignment_siteId_idx" ON "ForemanSiteAssignment"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "ForemanSiteAssignment_foremanId_siteId_key" ON "ForemanSiteAssignment"("foremanId", "siteId");

-- AddForeignKey
ALTER TABLE "ForemanSiteAssignment" ADD CONSTRAINT "ForemanSiteAssignment_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForemanSiteAssignment" ADD CONSTRAINT "ForemanSiteAssignment_foremanId_fkey" FOREIGN KEY ("foremanId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enable deny-by-default RLS (defense-in-depth; app role `postgres` bypasses RLS).
ALTER TABLE "ForemanSiteAssignment" ENABLE ROW LEVEL SECURITY;
