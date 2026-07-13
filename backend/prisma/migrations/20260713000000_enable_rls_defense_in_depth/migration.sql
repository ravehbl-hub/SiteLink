-- Migration: enable_rls_defense_in_depth
-- Owner: Savant (DB). Defense-in-depth, NOT authorization-in-DB.
--
-- WHAT / WHY
-- ----------
-- Enable Row-Level Security (RLS) on every application table with a
-- DENY-BY-DEFAULT posture: RLS is turned ON and NO permissive policy is created.
-- Under Postgres semantics, a table with RLS enabled and zero policies denies all
-- rows to any role that is NOT exempt from RLS. This closes a direct-Postgres /
-- PostgREST (anon / authenticated) read/write path — a hypothetical client that
-- bypasses the Fastify service (the single authz boundary per FR-X-RBAC-2 and
-- ARCHITECTURE §241) can no longer touch these tables directly.
--
-- This migration deliberately adds NO policies and NO auth.uid() logic. It does
-- NOT move authorization into the database. It is purely
--   "RLS enabled + deny-by-default; the service connection bypasses RLS".
--
-- APP CONNECTION ROLE (empirically verified, not assumed)
-- ------------------------------------------------------
-- The Fastify runtime (pooler / DATABASE_URL) and Prisma Migrate (DIRECT_URL)
-- both connect as role `postgres`:
--     current_user = session_user = 'postgres'
--     pg_roles.rolbypassrls = true   (postgres has BYPASSRLS)
--     postgres also OWNS every public table.
-- Because `postgres` has BYPASSRLS, RLS never applies to the application's
-- queries — the back-end suite keeps working UNCHANGED. Verified empirically:
-- even a table with FORCE ROW LEVEL SECURITY and zero policies still returns all
-- rows to `postgres`, because rolbypassrls supersedes FORCE.
--
-- ENABLE vs FORCE
-- ---------------
-- We use plain ENABLE ROW LEVEL SECURITY (NOT FORCE):
--   * ENABLE alone already achieves deny-by-default for non-exempt roles
--     (anon / authenticated). That is the entire security goal.
--   * The app role (`postgres`) is exempt via BYPASSRLS regardless of ENABLE/FORCE,
--     so FORCE would add zero security benefit here.
--   * FORCE makes RLS apply to the table OWNER too. It buys nothing while `postgres`
--     keeps BYPASSRLS, and it would become a silent foot-gun if the app were ever
--     repointed to a non-bypass owner role. ENABLE is the Supabase-recommended
--     posture and matches least-surprise.
--
-- Prisma 7 does not model RLS, so this is a hand-written SQL migration applied by
-- `prisma migrate deploy`.

ALTER TABLE "User"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Site"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SiteAssignment"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Worker"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkerDoc"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkerSalaryData"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AttendanceRecord"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProfessionWageRate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Loan"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdvancePayment"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProfitLoss"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkerRequest"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Customer"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Billing"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Usage"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BusinessProfitLoss" ENABLE ROW LEVEL SECURITY;
