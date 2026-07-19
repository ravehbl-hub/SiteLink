# Multi-Tenancy — APPROVED DECISIONS

> User approved all 6 recommended decisions on 2026-07-19. Build in a fresh session,
> starting from `MULTI-TENANCY-PLAN.md` + `MULTI-TENANCY-SCHEMA.md`. **Phase 1 first.**

## The model
`Company (tenant) → Manager, Foreman, Worker`. Every user belongs to a Company.
A Manager sees ONLY same-company users/data. System Admin (ADMIN) is super-admin
above all companies and creates companies + their users.

## Approved decisions (all = the architects' recommendation)
1. **Entity** — NEW `Company` model (linked to `Customer`), not a rename. Keeps the
   authz boundary decoupled from the nullable/optional billing model.
2. **PersonnelCompany** — PER-TENANT (scoped to a company).
3. **ProfessionWageRate** — PER-TENANT, with a per-company global fallback.
4. **ADMIN narrowing** — ADMIN may read-scope into one company via `?companyId`.
5. **Customer↔Company** — enforce **1:1**.
6. **Rollout** — PHASED (not big-bang):
   - **P1**: `Company` + `User.companyId` + scope the Users surface + System-Admin
     create-company/create-manager. Backfill existing data to a Default Company.
   - **P2**: propagate `companyId` to Worker/Site + all operational services
     (workers, attendance, requests, salary, dashboard, reports).
   - **P3**: hardening + full nexo adversarial cross-company sweep + backfill
     verification + storage/payslip-share scoping.

## Non-negotiables
- Every tenant-owned row carries a DIRECT `companyId` (not join-derived — login-less
  workers would otherwise be unscoped = leak). `where: { companyId }` everywhere.
- `User.email` stays GLOBALLY unique (Supabase Auth requirement).
- Fastify stays the single authz boundary; company scope ANDs with site/self scope
  (foreman = company AND sites; worker = company AND self).
- **nexo must adversarially prove** a Manager of company A can never read/write ANY
  of company B's users/workers/sites/attendance/requests/salary/reports/storage.
- Migration: nullable companyId → backfill to Default Company → verify zero NULLs →
  NOT NULL → indexes.
- Top leak risks to watch: `salary.calculateMany` (batch + global wage fallback),
  dashboard/P&L aggregates (silent cross-company sums), storage keys/signed URLs,
  payslip-share recipient resolution.

## Also pending (unrelated, carry into next session)
- **Salary rate-fallback** product decision (103/106 workers have no `WorkerSalaryData`
  → rate defaults to 50). Decide: default rate / profession wage rate / require setup.
- **SMTP/Resend creds** for real payslip-email sending (feature built, key-gated).
- **Wage 0-hours bug**: was being fixed — verify it landed (salary showed 0h despite
  108 logged hours for Dimitar Angelov).
