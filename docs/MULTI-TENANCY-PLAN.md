# SiteLink — Company-Based Multi-Tenancy PLAN

> Owner: Matrix (architecture). Status: **PLANNING ONLY — awaiting user approval. BUILD NOTHING.**
> Concurrent: Lattice is drafting the concrete Prisma schema. This plan defines the design
> at the shape level (companyId on User + the direct-vs-derived set below); the schema draft
> must not contradict it.

## 0. Goal (restated)

Turn SiteLink from **single-tenant** (Managers see all users/workers/sites, filtered only by
role) into **multi-tenant by company**:

- Hierarchy: **Company → { Manager, Foreman, Worker }**. Every user belongs to exactly one Company.
- A **MANAGER** sees only users/workers/sites/data in their **OWN** company.
- **SYSTEM ADMIN (ADMIN role)** is the super-admin above all companies: creates companies and
  provisions each company's Manager (and other users). Cross-company by design.
- A **FOREMAN** is scoped to their company AND their site(s) (existing site scope, intersected).
- A **WORKER** is scoped to their company AND themselves (existing self scope, intersected).

The catastrophic failure mode is **cross-company data leakage**. Every decision below is biased
toward leak-resistance over normalization.

---

## 1. ENTITY DECISION — the tenant "Company"

### Recommendation: **introduce a NEW `Company` model as the tenant root. Do NOT reuse or rename `Customer`.**

**Rationale.** `Customer` today is SiteLink's own **SaaS billing subject** — the entity the System
Admin bills (`Billing`, `Usage`, `BusinessProfitLoss` all FK `customerId → Customer`, all
ADMIN-only per `backoffice/customers-service.ts`). The tenant "Company" is an **operational
ownership boundary** — the thing that *owns* users, workers, sites, attendance, salary. These are
two different jobs:

- **Customer** = "who pays SiteLink / SaaS lifecycle" (registeredAt, leftAt, plan, usage metrics).
- **Company** = "who owns this operational data / the authorization tenant".

They are *conceptually 1:1 in the common case* (one paying customer == one operating company), but
collapsing them is risky:

1. It would make the security-critical tenant boundary depend on a model whose semantics
   (billing lifecycle, `leftAt`, archival) are driven by SaaS concerns — coupling authz to billing.
2. `BusinessProfitLoss.customerId` is **nullable** and `Customer` is a `[future / modeled]` BO
   entity; the tenant root must be a hard, always-present, NOT-NULL anchor.
3. Future flexibility: a customer could operate multiple companies (subsidiaries) or a company
   could be onboarded before billing exists. A clean FK keeps that open without a migration.

**Chosen shape:** a new first-class `Company` model, and a **nullable `Company.customerId → Customer`**
link so the System Admin can associate a tenant company with its billing customer (1:1 in practice,
enforced by a unique index if desired). This keeps billing where it is and gives us a clean,
NOT-NULL tenant anchor for authz.

> If the user prefers minimal new surface and accepts the coupling, the fallback is
> **rename `Customer → Company` + fold billing FKs**. Not recommended — see risks. The plan below
> assumes the **new `Company`** decision.

### PersonnelCompany is a DIFFERENT concept — keep separate.

`PersonnelCompany` = staffing/manpower firms that **supply** workers (name + contact, `Worker.personnelCompanyId`).
It is **not** the tenant. It must not be conflated with `Company`. Open question for §7: is a
`PersonnelCompany` **shared across tenants** or **per-tenant**? Recommendation: **per-tenant**
(add `PersonnelCompany.companyId`) to prevent a cross-tenant leak via a shared staffing row and to
avoid one company editing another's supplier list. (See risks R6.)

---

## 2. OWNERSHIP GRAPH — how every entity attaches to a Company

**Principle: DENORMALIZE `companyId` onto every tenant-owned row that is ever queried directly or
listed.** Do not rely solely on derivation through relations. Rationale: every scoped list/read
becomes a trivial, uniform `where: { companyId }` filter — impossible to forget, cheap to index,
and impossible to leak via a mis-joined relation. Derivation-only (e.g. "filter attendance by
joining through Worker") is exactly the join-path that leaks when someone writes a query that
forgets the join. The storage cost of one cuid column + index per row is negligible against the
catastrophic cost of a cross-tenant leak.

### Authoritative company per entity

| Entity | `companyId`? | Authoritative source | Notes |
|---|---|---|---|
| **User** | **DIRECT (NOT NULL)** | itself | The anchor for people. Server-stamped from creator's company. |
| **Worker** | **DIRECT (NOT NULL)** | itself | Do NOT derive via `Worker.userId` — `userId` is **nullable** (most workers have no login). Deriving would leave login-less workers unscoped. Stamp directly. |
| **Site** | **DIRECT (NOT NULL)** | itself | Anchor for site-scoped data. |
| **SiteAssignment** | DIRECT (denormalized) | `Site.companyId` (== `Worker.companyId`) | Worker↔Site join; both sides same company. Stamp on create. |
| **ForemanSiteAssignment** | DIRECT (denormalized) | `Site.companyId` (== `foreman User.companyId`) | Same. |
| **AttendanceRecord** | **DIRECT** | `Worker.companyId` | Listed/aggregated heavily (dashboard, reports, salary). Must filter fast. |
| **WorkerRequest** | **DIRECT** | `Worker.companyId` | |
| **Loan** | **DIRECT** | `Worker.companyId` | Financial — leak = catastrophic. |
| **AdvancePayment** | **DIRECT** | `Worker.companyId` | Financial. |
| **WorkerSalaryData** | **DIRECT** | `Worker.companyId` | 1:1 with Worker; salary batch reads by `workerId IN` — needs its own guard. |
| **WorkerRating** | **DIRECT** | `Worker.companyId` (== foreman's company) | |
| **WorkerDoc** | **DIRECT** | `Worker.companyId` | Signed-URL/storage risk (R7). |
| **ProfessionWageRate** | **DIRECT** (recommended per-tenant) | itself | Currently keyed `@@unique([profession, siteId])` with global `siteId=null` fallback. Multi-tenant: unique becomes `[companyId, profession, siteId]`; global fallback becomes per-company. See R5. |
| **ProfitLoss** (site P&L) | DIRECT | `Site.companyId` | |
| **PersonnelCompany** | **DIRECT** (recommended per-tenant) | itself | See R6; `name @unique` becomes `@@unique([companyId, name])`. |
| **Customer / Billing / Usage / BusinessProfitLoss** | **NO companyId** | ADMIN-only billing plane | Stays cross-company (System Admin surface). `Company.customerId` links the two. |

**Why Worker is DIRECT, not derived via User:** `Worker.userId` is nullable and unique — the vast
majority of the 100+ seeded workers have no login. Deriving Worker's tenant through User would leave
those workers with **no company** → either unscoped (leak) or invisible. Direct `Worker.companyId`
is the only safe choice.

**Consistency invariant (enforced in service writes, and asserted by nexo):** for any child row,
`child.companyId == parent.companyId` (e.g. `AttendanceRecord.companyId == Worker.companyId ==
Site.companyId`). Writes derive the child's companyId from the server-resolved parent, never from
the client.

---

## 3. SCOPING / SECURITY BOUNDARY

### 3.1 New primitive in `lib/scope.ts`: `resolveCompanyScope(user)`

```
export type CompanyScope = { companyId: string } | { allCompanies: true };

resolveCompanyScope(user): CompanyScope
  - ADMIN                     → { allCompanies: true }   // System Admin, cross-company
  - MANAGER | FOREMAN | WORKER → { companyId: user.companyId }
  - user with no companyId (should be impossible post-migration) → 403 (fail-closed)
```

`user.companyId` comes from **server-side truth** (`req.appUser`, hydrated from the DB `User` row),
**never** from a client-supplied field. This mirrors the existing site-scope discipline
("derived entirely from the SERVER-side req.appUser").

### 3.2 Composition with existing site/worker scope

The company scope **composes as an AND** with the existing scopes — it never replaces them:

- **MANAGER**: company filter only (was unscoped; now `where.companyId = scope.companyId`).
- **FOREMAN**: `companyId = X` **AND** `siteId IN union` (existing `resolveSiteScope`). Because a
  foreman's sites are already in their company, the company filter is defense-in-depth + covers
  any query that isn't site-keyed.
- **WORKER**: `companyId = X` **AND** `workerId = self` (existing `resolveWorkerId`).

Provide a helper `scopedWhere(user, base)` that returns `base` extended with the company filter
(and, for foreman/worker surfaces, composed with the site/worker filter) so services apply one
uniform helper instead of hand-rolling `where` clauses.

### 3.3 ADMIN model — is ADMIN cross-company, or is there a per-company admin?

Per the requirement: **ADMIN (System Admin) is the sole cross-company super-admin**; the
**MANAGER is the per-company admin**. No new "company admin" role is introduced — MANAGER already
*is* that role once company-scoped. `manageableRolesFor` already restricts a MANAGER to
{MANAGER, FOREMAN, WORKER}; multi-tenancy adds the orthogonal company filter on top.

> Decision point for the user: should ADMIN be able to *impersonate/scope into* a single company
> (e.g. `?companyId=`)? Recommended: yes for reads (ADMIN + `?companyId` narrows, like
> `effectiveSiteScope` narrows ADMIN by `?siteId`), never implicitly for writes.

### 3.4 ENFORCEMENT POINTS (every list/read/write must apply company scope)

| Module | Surface | Change |
|---|---|---|
| `users/service.ts` | `list/get/create/update/setLockout/remove` | Add `companyId` to every `where`; `loadManageableTarget` must 404/403 on cross-company id; `create` stamps creator's companyId (ADMIN supplies target companyId, MANAGER = own). |
| `workers/service.ts` | list/get/create/update/archive/docs | `companyId` on every where; create stamps company. |
| `sites/service.ts` | list/get/create/update/archive | company on every where; create stamps company. |
| `attendance/service.ts` | list/upsert | company filter; write stamps from Worker. |
| `requests/service.ts` | list/decide/effects | company filter; approval side-effects inherit company. |
| `finance/service.ts` (Loan/Advance/ProfitLoss) | list/create | company filter + stamp. |
| `salary/service.ts` | `calculateMany` **(HIGH RISK)** | **must not** trust caller `workerIds`. Add `companyId` to the `worker.findMany` **and** the `attendanceRecord.findMany` and `professionWageRate.findMany` (R5). Callers pass company scope, not raw ids. |
| `dashboard/service.ts` | all aggregates | every count/sum gets `companyId` (R4 — aggregates that sum across companies are silent leaks). |
| `reports/service.ts` | payslip/report generation | filter by company; payslip-share (email/whatsapp) must resolve recipient within company (R8). |
| `ratings/service.ts` | list/create | company filter + stamp. |
| `foreman-assignments/service.ts` | assign/unassign/list | site+foreman must be same company as caller. |
| `personnel-companies/service.ts` | list/CRUD | per-tenant filter (R6). |
| `backoffice/*` | Customers/Billing/Usage | **unchanged** (ADMIN-only cross-company billing plane) + new Company CRUD (§5). |

**Enforcement layer:** the **Fastify service layer remains the single authz boundary** (as today —
`requireRole` is the coarse gate, `scope.ts` the fine one). No new boundary; we extend the existing
one. Every service method that reads/writes a tenant-owned entity applies `resolveCompanyScope`.

### 3.5 Invariants nexo must adversarially verify

For a MANAGER (or FOREMAN/WORKER) of company **A** holding a valid token, on **every** path:

1. Cannot **read** another company's user/worker/site/attendance/request/loan/advance/salary/
   rating/doc/report/dashboard-aggregate — result is **403 or empty**, never a foreign row.
2. Cannot **write** (create/update/archive/decide/assign) any entity in company B — **403**;
   cannot set `companyId` via client input (server-stamped only) to smuggle a row into B, nor
   pull a row from B by supplying B's id (TOCTOU — re-check company on the loaded row, mirroring
   the existing "Item-A TOCTOU" and "loadManageableTarget" pattern).
3. **No leak via shared reference data**: `PersonnelCompany`, `ProfessionWageRate` — a company-A
   caller never sees/uses company-B's supplier or wage rows.
4. **No aggregate leak**: dashboard/reports/P&L/salary-batch numbers for company A **exclude** all
   company-B rows (the `calculateMany` batch and dashboard sums are the prime suspects).
5. **No relation-join leak**: any `include`/nested read (e.g. Worker→docs, Request→createdLoans)
   stays within the company; a foreign child is never surfaced through a parent.
6. **ADMIN** can legitimately read across companies (and, if enabled, narrow by `?companyId`).
7. **Backfill completeness**: zero tenant-owned rows with NULL companyId after migration; a
   deliberately company-mismatched child row (child.companyId ≠ parent.companyId) is rejected.

---

## 4. MIGRATION / BACKFILL SEQUENCE

Existing data is single-tenant and must all land in one **Default Company** with **no orphans, no
leaks**. Sequenced to be safe on a live DB (add nullable → backfill → enforce → index):

**Step 0 — create `Company` model** (nullable `customerId` link) via migration. No data yet.

**Step 1 — seed the Default Company.** One row, e.g. `name = "Default Company"`. Optionally link it
to an existing `Customer` if exactly one is the operating tenant (System Admin decides); otherwise
leave `customerId` null.

**Step 2 — add `companyId` as NULLABLE** on every tenant-owned model (§2 table). No NOT NULL yet.

**Step 3 — backfill** in dependency order, all pointing at the Default Company id:
  1. `User.companyId` = default (all existing users).
  2. `Site.companyId` = default.
  3. `Worker.companyId` = default (covers the 100+ seeded demo workers — stamped directly, not via
     nullable `userId`).
  4. `PersonnelCompany.companyId`, `ProfessionWageRate.companyId` = default.
  5. Children derived from their parent (all == default anyway): `SiteAssignment`,
     `ForemanSiteAssignment`, `AttendanceRecord`, `WorkerRequest`, `Loan`, `AdvancePayment`,
     `WorkerSalaryData`, `WorkerRating`, `WorkerDoc`, `ProfitLoss`.

**Step 4 — verify zero NULLs** (a `SELECT count(*) WHERE companyId IS NULL` == 0 gate on every
table) BEFORE enforcing. nexo/Bugo assert this.

**Step 5 — ALTER to NOT NULL** on every companyId column.

**Step 6 — add indexes**: `@@index([companyId])` on every tenant table; composite indexes where the
scoped query pairs company with another key — e.g. `AttendanceRecord @@index([companyId, date])`,
`Worker @@index([companyId, isArchived])`, `Site @@index([companyId, status])`. Update the changed
uniques: `ProfessionWageRate @@unique([companyId, profession, siteId])`,
`PersonnelCompany @@unique([companyId, name])`.

**Reversibility:** Steps 2–3 are additive and reversible; Step 5 (NOT NULL) is the point of no easy
return — gate it on Step 4 passing.

---

## 5. SYSTEM ADMIN FLOWS

### 5.1 Create Company
New ADMIN-only surface on the System Admin web app (alongside Customers): create/list/update/archive
`Company`, optionally linking to a billing `Customer`. Mirrors `CustomersService` shape.

### 5.2 Provision a Manager (and other users) into a company
The existing **dual-write** user-provisioning (`users/service.ts` → Supabase identity + app `User`
row) **gains `companyId`**:
- **ADMIN** creating a user: supplies the target `companyId` (required for MANAGER/FOREMAN/WORKER).
  This is how "add company + create its manager" works — ADMIN picks the company.
- **MANAGER** creating a FOREMAN/WORKER: `companyId` is **server-derived from the manager's own
  `req.appUser.companyId`** — the client value is ignored/rejected. A manager can never create a
  user in another company.
- The compensating Supabase-delete-on-failure logic is unchanged; companyId is part of the app-row
  write inside the same unit of work.

### 5.3 Manager creating a Foreman/Worker (and Worker records)
Every create path (`users`, `workers`, `sites`, and all children) **stamps `companyId` from the
server-resolved caller company**, never from a client field. This is the write-side twin of §3.5
invariant 2.

### 5.4 UI
Company-management screens live on the **System Admin (ADMIN) web app** (Maestro's admin surface).
The Manager web app gains **no** company selector — a manager's company is implicit.

---

## 6. PHASING (recommended — big-bang is too risky)

A single migration touching ~15 models + every service is high-blast-radius. Phase it so each phase
is independently shippable, testable, and leak-audited:

**Phase 1 — Tenant root + People plane.**
- Add `Company` model + Default Company seed.
- Add `User.companyId` (nullable → backfill → NOT NULL → index).
- Scope the **Users** surface (`users/service.ts`) by company.
- System Admin: create-company + create-manager-into-company flows.
- nexo audits the Users surface for cross-company leaks.
- *Ships a working, if partial, multi-tenant people boundary with minimal blast radius.*

**Phase 2 — Operational plane.**
- Add `companyId` to Worker + Site + all children (nullable → backfill → NOT NULL → index),
  including PersonnelCompany + ProfessionWageRate per-tenant re-keying.
- Extend `resolveCompanyScope` composition into workers/sites/attendance/requests/finance/
  salary/dashboard/reports/ratings/foreman-assignments.
- Harden `salary.calculateMany` and dashboard aggregates (the batch/aggregate leak vectors).

**Phase 3 — Hardening + full adversarial audit.**
- nexo full cross-company adversarial sweep on **every** path (the §3.5 invariants).
- Backfill-completeness verification (zero NULL, no mismatched child).
- Storage-key / signed-URL / payslip-share recipient scoping (R7, R8).
- Load/index review.

**Risk-minimizing order rationale:** People first (smallest, highest-value boundary, unblocks the
System Admin flows the user explicitly asked for), then the wider operational graph, then
hardening. Each phase leaves the system consistent (Default Company keeps single-tenant behavior
identical until real companies are created).

---

## 7. RISKS — cross-company leakage is the catastrophic failure

**Leak vectors to enumerate and close (nexo targets):**

- **R1 — Unscoped list query.** Any service `findMany` that forgets `companyId`. Mitigation:
  uniform `scopedWhere` helper + nexo enumerates every list endpoint. (Analogue: the real
  `LIST unassignedAt` leak nexo already caught.)
- **R2 — Relation/join crossing tenants.** An `include` or nested read surfacing a foreign child.
  Mitigation: direct `companyId` on children + consistency invariant + nexo nested-read probes.
- **R3 — TOCTOU on id-supplied writes.** Loading a row by client id then acting without
  re-checking company (the prior "Item-A TOCTOU"). Mitigation: `loadManageableTarget`-style
  company re-check on every id-addressed mutation.
- **R4 — Aggregate/dashboard leak.** A dashboard count/sum or P&L that spans companies — silent,
  numbers just wrong-and-inflated. Mitigation: `companyId` on every aggregate; nexo asserts A's
  totals exclude B's rows.
- **R5 — `salary.calculateMany` batch.** Reads by `workerId IN (...)`, `attendanceRecord IN`, and
  `professionWageRate` with a **global `siteId=null` fallback** — all currently unscoped by
  company. **Highest-risk single function.** Mitigation: add `companyId` to all three reads;
  make the wage-rate global fallback **per-company**; never trust caller-supplied ids.
- **R6 — Shared `PersonnelCompany`.** If left global, company A sees/edits B's suppliers, and a
  worker could link across tenants. Mitigation: per-tenant `companyId` + `@@unique([companyId,name])`.
  Note: dedupe backfill for personnel companies now dedupes **within** a company.
- **R7 — Storage keys / signed URLs.** `Worker.imageStorageKey`, `WorkerDoc.storageKey` — a signed
  URL or predictable key could expose another company's file. Mitigation: authorize the owning
  row's company before minting any signed URL; consider namespacing keys by companyId.
- **R8 — Payslip-share (email/WhatsApp).** `reports` share flow resolves a recipient/phone — must
  resolve strictly within the caller's company; a cross-company workerId must 403, not send.
- **R9 — Scope-creep / effort.** ~15 models, ~13 services, uniques + indexes re-keyed, plus the
  System Admin UI. This is a multi-phase program, not a patch. `Customer↔Company` semantics and
  the PersonnelCompany/wage-rate per-tenant decisions each need an explicit user call.

**Go / No-Go considerations:**
- **Go** if: the Default-Company backfill verifies zero orphans (Step 4 gate), nexo signs off each
  phase's invariants, and the user confirms the entity decision (new `Company`) + the per-tenant
  treatment of PersonnelCompany and ProfessionWageRate.
- **No-Go / pause** if: any phase can't demonstrate zero cross-company leakage under nexo's
  adversarial sweep — a partial multi-tenancy that leaks is worse than staying single-tenant.

---

## 8. Open decisions for the USER (approval gate)

1. **Entity:** approve **new `Company` model** (recommended) vs rename `Customer→Company`?
2. **PersonnelCompany:** per-tenant (recommended) vs shared-global?
3. **ProfessionWageRate:** per-tenant with per-company global fallback (recommended) vs shared?
4. **ADMIN narrowing:** allow ADMIN read-scoping via `?companyId` (recommended for reads)?
5. **Customer↔Company link:** enforce 1:1 (unique `Company.customerId`) or allow 1:many?
6. **Phasing:** approve the 3-phase rollout (recommended) vs big-bang?

**No code, schema, or migration will be written until these are approved.**
