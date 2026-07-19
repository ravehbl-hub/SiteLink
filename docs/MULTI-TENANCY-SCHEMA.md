# SiteLink — Multi-Tenancy Schema Design

**Owner:** Lattice (Schema). **Status:** DESIGN / PLANNING ONLY — no migration, no `schema.prisma` edit implied by this doc. Feeds a user-approval gate.
**Source of truth read:** `backend/prisma/schema.prisma` (Phase 01 CREATE, as committed).
**Sibling doc:** Matrix's architecture/scoping/phasing plan. This schema matches Matrix's ownership-graph recommendation: **direct `companyId` on `User` + the direct-root set**, everything else derives.

---

## 0. Executive decision summary

- **Tenant entity:** reuse the existing `Customer` model, **renamed to `Company`**. One row per tenant. Billing/Usage/BusinessProfitLoss stay attached to it (they already FK `customerId`; those relations are renamed to `companyId`, semantics unchanged). This avoids introducing a parallel `Company` + `Customer` pair that would need to be kept 1:1 forever.
- **`PersonnelCompany` stays SEPARATE** — it is a *staffing firm* the tenant works with, not the tenant itself. It becomes **per-company scoped** (gets its own `companyId`).
- **DIRECT `companyId` (own column, indexed):** `User`, `Worker`, `Site`, `AttendanceRecord`, `WorkerRequest`, `Loan`, `AdvancePayment`, `ProfessionWageRate`, `PersonnelCompany`, `ProfitLoss`.
- **DERIVED company (no own column — reached via a parent FK):** `WorkerSalaryData` (via Worker), `WorkerDoc` (via Worker), `WorkerRating` (via Worker), `SiteAssignment` (via Site+Worker), `ForemanSiteAssignment` (via Site+User).
- **`onDelete` for every `companyId` FK:** `Restrict`. A tenant is retired by soft-archive (`isArchived`/`leftAt`), never by a cascade that would silently delete a whole company's operational history.
- **Uniqueness changes:** `User.email` stays **global** (Supabase Auth email is global). `ProfessionWageRate` `@@unique([profession, siteId])` → `@@unique([companyId, profession, siteId])`. `PersonnelCompany` `name @unique` → `@@unique([companyId, name])`.

---

## 1. Tenant entity decision

### Recommendation: adopt `Customer` as `Company` (rename)

The existing `Customer` model already **is** the tenant object in everything but name:

- It is the SaaS billing entity (one per paying organization).
- It already owns `Billing[]`, `Usage[]`, `BusinessProfitLoss[]` — the per-tenant SaaS-business records.
- It already has the tenant-lifecycle fields a Company needs: `name`, `contactEmail`, `contactPhone`, `registeredAt`, `leftAt`, `isArchived`, `archivedAt`.

Creating a *new* `Company` model beside `Customer` would force a permanent 1:1 `Company ⇄ Customer` join and split "who the tenant is" across two tables — a cross-tenant-leak and reconciliation hazard. Reusing `Customer` keeps billing attached to the same row that scopes operational data.

**Change:** `model Customer` → `model Company`. Rename the three back-relations' FK fields `customerId` → `companyId` on `Billing`, `Usage`, `BusinessProfitLoss` (relation semantics and `onDelete` unchanged: `Billing`/`Usage` stay `Cascade` on the parent tenant; `BusinessProfitLoss.customerId` stays nullable). No data shape change — `Customer` today has no rows in most single-tenant installs beyond seed, and the migration (§4) creates the DEFAULT company explicitly.

> If the approval gate prefers to *keep the name* `Customer` for billing continuity, the fallback is: keep `model Customer` and let `companyId` FKs point at `Customer.id` with a `@map` alias in code. This doc recommends the clean rename; the fallback is noted only so the gate has the option. **Recommended: rename.**

`PersonnelCompany` is untouched as an identity — it remains a distinct model (staffing firm), only gaining a `companyId` scope (§3).

---

## 2. The `companyId` columns — exact per-model decisions

Rule applied: **DIRECT column** on the tenant root and on every high-traffic / independently-queried entity (leak-resistant, index-friendly, filterable without a join). **DERIVE** for tightly-owned children that are never queried except through their already-scoped parent.

Field shape for every DIRECT model (mirrors existing style):

```prisma
company   Company @relation(fields: [companyId], references: [id], onDelete: Restrict)
companyId String
@@index([companyId])
```

### DIRECT `companyId` models

| Model | Relation / onDelete | Indexes to add | Why DIRECT |
|---|---|---|---|
| `User` | `company Company @relation(..., onDelete: Restrict)` | `@@index([companyId])`, `@@index([companyId, role])` | Root of the human hierarchy (Manager/Foreman/Worker). Every auth/scope decision starts here; must filter by company without a join. Matrix's ownership graph roots on `User.companyId`. |
| `Worker` | same | `@@index([companyId])`, `@@index([companyId, isArchived])`, `@@index([companyId, profession])` | Highest-traffic entity; worker lists are the core Manager screen and are always company-filtered. A login-less worker has no `User`, so it **cannot** derive from User — it needs its own column. |
| `Site` | same | `@@index([companyId])`, `@@index([companyId, status])`, `@@index([companyId, isArchived])` | Independently listed/filtered; anchors many derivations (assignments, attendance, wage rates). |
| `AttendanceRecord` | same | `@@index([companyId, date])` (+ keep `[siteId, date]`, `[date]`) | Very high row count, queried by date range per company. Direct column avoids a `worker`→`company` join on every report. `siteId` is nullable, so cannot derive via Site. |
| `WorkerRequest` | same | `@@index([companyId, status])`, `@@index([companyId, type])` | Request inbox is per-company; status/type filters are hot. |
| `Loan` | same | `@@index([companyId, date])` | Financial ledger; per-company P&L and reports scan by date. |
| `AdvancePayment` | same | `@@index([companyId, date])` | Same as Loan. |
| `ProfessionWageRate` | same | `@@index([companyId, profession])` (replaces `[profession]`) | Wage rules are tenant policy; `siteId` is nullable (company-wide rate), so cannot derive via Site. Needs its own column. |
| `PersonnelCompany` | same | `@@index([companyId, isArchived])` | Staffing-firm list is tenant-specific; queried/CRUD'd directly. |
| `ProfitLoss` | `company Company @relation(..., onDelete: Restrict)` | `@@index([companyId, periodStart, periodEnd])` | Site-level P&L; `siteId` is nullable (company-wide P&L rows), so a direct column is required for safe filtering. |

### DERIVED company (NO own column)

| Model | Company reached via | Why DERIVE (not direct) |
|---|---|---|
| `WorkerSalaryData` | `worker.companyId` (1:1 to Worker) | Strict 1:1 child of Worker; never queried except through its worker. A direct column would be a duplicate that can drift from Worker. |
| `WorkerDoc` | `worker.companyId` | Owned 1:N child of Worker, `onDelete: Cascade` from Worker. Always fetched via a scoped worker. |
| `WorkerRating` | `worker.companyId` (the rated worker is authoritative) | Owned child of Worker. Note: `foreman` (User) is same-company by construction; the **worker** is the tenant anchor. Enforced by the service (§5), verified by nexo audit. |
| `SiteAssignment` | `site.companyId` (== `worker.companyId`) | Pure join row between two already-scoped parents. `onDelete: Cascade` from both. Both endpoints must be same-company — a service-level invariant (§5). |
| `ForemanSiteAssignment` | `site.companyId` (== `foreman.companyId`) | Same as SiteAssignment: join row between a scoped Site and a scoped User. |

**Rationale for the DIRECT/DERIVE split:** the direct set is exactly the entities that (a) are listed/filtered on their own, (b) can be reached by a nullable-parent path (`siteId?` on Attendance / WageRate / ProfitLoss), or (c) can exist with no login (login-less Worker). Deriving those would create either an unsafe optional join or an un-filterable table scan. The derived set are strict owned children reached only through an already-company-scoped parent, so a duplicate column would add drift risk with no query benefit.

---

## 3. Constraints, uniqueness & integrity

### 3.1 `User.email` — stays GLOBAL unique

Keep `email String @unique`. Supabase Auth treats email as a **global** identity (one Supabase user per email across the whole project). Making email per-company unique here would allow two SiteLink `User` rows for one Supabase auth identity, which Supabase cannot represent. `authUserId @unique` also stays global. **No change.**

### 3.2 `ProfessionWageRate` — per-company

A wage rate is tenant policy. Change:

```prisma
// was:  @@unique([profession, siteId])
@@unique([companyId, profession, siteId])
```

This lets Company A and Company B each define a rate for the same `(profession, siteId=null)` company-wide slot without colliding. Replace `@@index([profession])` with `@@index([companyId, profession])`.

### 3.3 `PersonnelCompany` — per-company

A staffing-firm directory is tenant-specific (Company A's "Acme Staffing" is not Company B's). Change:

```prisma
// was:  name String @unique
name String
...
@@unique([companyId, name])
```

The backfill's case-insensitive dedupe (already documented in the existing `add_personnel_company` migration) now dedupes **within** a company. Since single-tenant data all lands in the DEFAULT company (§4), existing uniqueness is preserved.

### 3.4 `AttendanceRecord.@@unique([workerId, date])` — unchanged

`workerId` already implies the company (Worker is company-scoped), so the "one record per worker/day" guard needs no company prefix. Same for `SiteAssignment.@@unique([siteId, workerId])` and `ForemanSiteAssignment.@@unique([foremanId, siteId])` — both endpoints are same-company by invariant, so the existing keys remain correct.

### 3.5 `onDelete` for the tenant FK — `Restrict` everywhere

Every `companyId` relation uses `onDelete: Restrict`. Deleting a `Company` row is **blocked** while any User/Worker/Site/etc. references it. Tenant retirement is a **soft-archive** (`Company.isArchived = true`, set `leftAt`), never a hard delete. This prevents an accidental `DELETE FROM Company WHERE id=…` from silently cascading away an entire tenant's workers, attendance, and financial ledgers.

- Existing intra-tenant cascades are **kept** (`WorkerDoc`, `SiteAssignment`, `Loan`, etc. still `Cascade`/`SetNull` from their operational parents) — those are safe because they stay within one tenant.
- `Billing`/`Usage` keep `Cascade` from `Company` (billing rows are meaningless without the tenant and are recreated on re-onboarding). `BusinessProfitLoss.companyId` stays nullable (`SetNull`-style) for retained aggregate reporting.

---

## 4. Migration & backfill sequence (safe, zero-orphan)

Executed as an ordered set of migrations. **No column is made `NOT NULL` until every row is backfilled and verified.**

### Step A — Establish the tenant entity + DEFAULT company
1. Rename `model Customer` → `Company`; rename FK fields `customerId` → `companyId` on `Billing`, `Usage`, `BusinessProfitLoss`.
2. Insert **one DEFAULT company row** to receive all existing single-tenant data:
   ```sql
   INSERT INTO "Company" (id, name, "registeredAt", "isArchived", "createdAt", "updatedAt")
   VALUES ('company_default', 'Default Company', now(), false, now(), now());
   ```
   (A stable well-known id — `company_default` — so backfills and later env checks can reference it.)

### Step B — Add NULLABLE `companyId` to every DIRECT model
Add `companyId String?` (nullable, no FK constraint yet, no index yet) to: `User`, `Worker`, `Site`, `AttendanceRecord`, `WorkerRequest`, `Loan`, `AdvancePayment`, `ProfessionWageRate`, `PersonnelCompany`, `ProfitLoss`. Nullable so the ALTER succeeds on populated tables.

### Step C — Backfill (per-model authoritative source, in dependency order)

| Order | Model | `companyId` backfill source |
|---|---|---|
| 1 | `User` | `= 'company_default'` (all existing users belong to the single existing tenant). |
| 2 | `Site` | `= 'company_default'`. |
| 3 | `PersonnelCompany` | `= 'company_default'`. |
| 4 | `ProfessionWageRate` | `= 'company_default'`. |
| 5 | `Worker` | `= User.companyId` **via** `Worker.userId` when the login link exists; **else** `= 'company_default'` (login-less legacy + the 100+ demo workers, which have `userId = NULL`). SQL: `COALESCE((SELECT u."companyId" FROM "User" u WHERE u.id = w."userId"), 'company_default')`. |
| 6 | `AttendanceRecord` | `= Worker.companyId` via `workerId` (NOT via `siteId`, which is nullable). |
| 7 | `WorkerRequest` | `= Worker.companyId` via `workerId`. |
| 8 | `Loan` | `= Worker.companyId` via `workerId`. |
| 9 | `AdvancePayment` | `= Worker.companyId` via `workerId`. |
| 10 | `ProfitLoss` | `= Site.companyId` via `siteId` when set; **else** `= 'company_default'` (company-wide P&L rows with `siteId = NULL`). |

> **Login-less & demo workers:** because `Worker` gets a DIRECT column and its backfill `COALESCE`s to `company_default`, the 100+ demo workers and any legacy worker with no `User` are correctly assigned — they never depend on a login that doesn't exist.

### Step D — Verify zero NULLs
For every DIRECT model, assert `SELECT count(*) FROM "<Model>" WHERE "companyId" IS NULL` returns `0`. The migration **aborts** if any is non-zero. (A nexo/CI check runs this across all ten tables.)

### Step E — Enforce NOT NULL + add FK
`ALTER COLUMN "companyId" SET NOT NULL` on all ten models, then add the FK constraint `REFERENCES "Company"(id) ON DELETE RESTRICT`.

### Step F — Add indexes + new composite uniques
Add all `@@index` entries from §2, then apply the uniqueness changes from §3:
- `ProfessionWageRate`: drop `@@unique([profession, siteId])` + `@@index([profession])`; add `@@unique([companyId, profession, siteId])` + `@@index([companyId, profession])`.
- `PersonnelCompany`: drop `name @unique`; add `@@unique([companyId, name])`.

(Uniqueness changes are last so they cannot fail mid-backfill; after all rows are in `company_default`, the new composite uniques are guaranteed satisfied since the old single-column uniques held.)

---

## 5. Authoritative source of `companyId` per entity

The single source of truth a service filters on and a **nexo audit** uses to prove no cross-tenant row is reachable:

| Entity | Authoritative source | Audit rule (must hold for every row) |
|---|---|---|
| `Company` | itself (`id`) | — |
| `User` | own `companyId` | — |
| `Worker` | own `companyId` | if `userId` set: `Worker.companyId == User.companyId` |
| `Site` | own `companyId` | — |
| `AttendanceRecord` | own `companyId` | `== Worker.companyId`; if `siteId` set, `== Site.companyId` |
| `WorkerRequest` | own `companyId` | `== Worker.companyId`; if `resolvedById` set, `resolvedBy.companyId ==` too |
| `Loan` | own `companyId` | `== Worker.companyId`; if `requestId` set, `== WorkerRequest.companyId` |
| `AdvancePayment` | own `companyId` | `== Worker.companyId`; if `requestId` set, `== WorkerRequest.companyId` |
| `ProfessionWageRate` | own `companyId` | if `siteId` set, `== Site.companyId` |
| `PersonnelCompany` | own `companyId` | linked `Worker.companyId ==` (SetNull FK; workers can only link within their company — service-enforced) |
| `ProfitLoss` | own `companyId` | if `siteId` set, `== Site.companyId` |
| `WorkerSalaryData` | **derived** `worker.companyId` | reachable only via its Worker |
| `WorkerDoc` | **derived** `worker.companyId` | reachable only via its Worker |
| `WorkerRating` | **derived** `worker.companyId` | `foreman.companyId == worker.companyId` (both same tenant) |
| `SiteAssignment` | **derived** `site.companyId` | `Site.companyId == Worker.companyId` |
| `ForemanSiteAssignment` | **derived** `site.companyId` | `Site.companyId == foreman.companyId` |

**Cross-tenant safety property:** every entity has a company anchor that is either its own indexed column (direct set) or a single already-scoped parent FK (derived set). No entity is reachable by a path that crosses tenants, and the join-row invariants above (Worker↔Site, foreman↔worker same-company) are enforceable as service-layer checks and provable by a nexo query that scans for any row violating the "Audit rule" column. `Company.onDelete = Restrict` guarantees no anchor can be orphaned by a tenant delete.

---

## 6. What this doc does NOT change
- No `schema.prisma` edit and no migration was run — this is the plan only.
- `WorkerLevel`/`WorkerRating.score`, enums, and all existing intra-tenant cascades are untouched except where §3.5 lists them.
- `authUserId` and `email` remain globally unique (Supabase Auth constraint).
