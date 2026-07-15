# SiteLink — System Architecture (Phase 01 / CREATE)

> Owner: Matrix (Architect). Topology diagram delegated to Concepto. Design phase
> (schema → Lattice, UI/UX → Styllo, servers → Servio) delegated to Origami.
> Status: v1 vertical slice = **Manager web + Manager app + back end**. All other
> role surfaces are designed-for but not built in v1.

---

## 0. Locked Decisions (context)

- TypeScript everywhere.
- Web = React; Native = React Native; both share a `shared-types` package.
- Single Node back end behind all front ends.
- PostgreSQL (managed by **Supabase**) + one ORM.
- Salary via swappable `SalaryRuleEngine` (Strategy).
- Hosting: Vercel (front ends) + Railway (back end) + **Supabase (managed Postgres)**.
- v1 scope: Manager surfaces + back end only.

---

## 1. Chosen Stack & Justifications

| Concern | Pick | Justification |
|---|---|---|
| Monorepo | **pnpm workspaces + Turborepo** | pnpm's content-addressed store + strict `node_modules` avoids phantom deps across web/native/backend; Turborepo gives cached, dependency-aware task graph (`build`, `lint`, `test`, `typecheck`). Best-in-class for a TS monorepo mixing Expo + web + Node. |
| Web front end | **Vite + React (SPA)** for Manager web | Manager web is an authenticated internal dashboard, not a public SEO/marketing site. Vite gives the fastest dev loop and simplest static-build deploy to Vercel. Next.js would add SSR/routing weight we don't need and would blur the "single back end" boundary (we explicitly do NOT want API routes here — see back end). If public marketing/SEO surfaces appear later, add a separate Next.js app; do not retrofit. |
| Native front end | **Expo (React Native)** | Managed workflow → OTA updates, EAS build, no native toolchain babysitting. Shares TS + business logic with web via workspace packages. |
| Back end | **Standalone Fastify service** (Node, TypeScript) | Chosen over Next.js API routes: we need ONE back end serving 5 heterogeneous clients (2 web + 3 native), long-running concerns (PDF gen, cron-style payroll), and clean deploy to Railway independent of Vercel front-end deploys. Fastify over Express: native TS types, schema-based validation (JSON Schema / Typebox), faster, first-class plugin/encapsulation model that maps cleanly to our module boundaries. |
| Database | **Supabase (managed PostgreSQL)** | Managed Postgres — schema, Prisma, and shared types are unchanged from vanilla Postgres. Supabase adds a hosted DB with connection pooling (PgBouncer), point-in-time backups, and a dashboard/SQL editor, removing the need to run our own DB plugin. In v1 we adopt Supabase for **DB + Auth + Storage** (see §5 for Auth, §7a for Storage): Prisma owns the schema/migrations; **Supabase Auth** issues sessions while the Fastify service stays the single **authorization** point; **Supabase Storage** holds worker images/docs behind signed URLs. RLS, Realtime, and Edge Functions are available but **deferred** (not used in v1). Connection uses the Supabase **pooler URL** (port 6543, `pgbouncer=true`) for the app runtime and the **direct URL** (port 5432) for Prisma Migrate. |
| ORM | **Prisma** | Type-safe client generated from a single schema → feeds our `shared-types` philosophy; first-class migrations (`prisma migrate`); excellent Postgres support; readable schema is a strong onboarding + design artifact. Trade-off (raw-SQL ergonomics for complex payroll aggregation) mitigated by Prisma's `$queryRaw` escape hatch where the salary engine needs window functions. Requires `datasource.directUrl` for migrations when running through the Supabase pooler. |
| Auth | **Supabase Auth (authentication) + app-side RBAC (authorization)** | Supabase Auth owns identity: signup/invite, email+password, session issuance (Supabase JWTs), refresh, and password reset — no bespoke credential/refresh code to maintain across native + web. The Fastify back end **verifies** the Supabase JWT on every request and remains the single **authorization** point: the 5-role RBAC + site-scoping live in our `User` table and are enforced server-side. RLS is available but off by default (defense-in-depth only, not the authz boundary in v1). Details in §5. |
| Validation | **Zod** (shared) + Typebox at Fastify edge | Zod schemas live in `shared-types` and are reused client + server for form + payload validation → single source of truth. |
| i18n | **i18next** (react-i18next + expo-localization) | One library, one translation-key namespace shared across web + native. |
| PDF | **Server-side, `@react-pdf/renderer`** | See §7. |

---

## 2. Monorepo / Workspace Layout

The existing topology fixes `Frontend/<role>/<platform>` directory names. **I honor them** rather than flattening to a conventional `apps/` layout — the role/platform hierarchy is meaningful domain structure and renaming would fight the established topology. I map them into pnpm workspaces via glob patterns.

```
SiteLink/Code/
├─ pnpm-workspace.yaml         # packages: Frontend/**, packages/*, backend
├─ turbo.json                  # task pipeline (build/lint/test/typecheck/dev)
├─ package.json                # root: devDeps, workspace scripts only
├─ tsconfig.base.json          # shared compiler options, path aliases
├─ .env.example                # documented env surface (never real secrets)
│
├─ Frontend/
│  ├─ manager/
│  │  ├─ web/        # @sitelink/manager-web   (Vite+React)      [v1]
│  │  └─ app/        # @sitelink/manager-app   (Expo RN)         [v1]
│  ├─ Foreman/
│  │  └─ app/        # @sitelink/foreman-app   (Expo RN)         [future]
│  ├─ Worker/
│  │  └─ app/        # @sitelink/worker-app    (Expo RN)         [future]
│  └─ backoffice/
│     └─ web/        # @sitelink/system-admin-web (Vite+React)     [future]
│
├─ packages/
│  ├─ shared/        # @sitelink/shared  (types, Zod schemas, enums, API client contract)
│  │  └─ src/
│  ├─ ui-web/        # @sitelink/ui-web  (shared React components, theming)   [add as needed]
│  ├─ ui-native/     # @sitelink/ui-native (shared RN components, theming)    [add as needed]
│  └─ i18n/          # @sitelink/i18n    (translation resources, locale config)
│
├─ backend/          # @sitelink/backend (Fastify service, Prisma)            [v1]
│  ├─ prisma/        # schema.prisma, migrations/
│  └─ src/
│
└─ docs/
   └─ ARCHITECTURE.md
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "Frontend/*/*"
  - "packages/*"
  - "backend"
```

**`@sitelink/shared` is the spine.** It exports: domain models/DTOs, Zod schemas, enums (`Role`, `RequestType`, `AttendanceStatus`, `SalaryStrategyId`), the typed REST contract (route → request/response types), and error codes. Both front ends and the back end depend on it. Prisma-generated types stay in the backend; hand-authored DTOs in `shared` are the wire contract (decouples DB shape from API shape).

---

## 3. Component Boundaries

### 3.1 Back-end module structure (Fastify plugin per domain)

Each domain is a Fastify plugin (encapsulated: own routes, service, repository). Cross-cutting concerns are decorators/hooks registered at root.

```
backend/src/
├─ app.ts                 # build Fastify instance, register plugins
├─ server.ts              # listen, graceful shutdown
├─ config/                # env parsing (Zod), typed config object
├─ plugins/               # cross-cutting: prisma, auth (JWT verify), rbac, i18n, logger, error-handler
├─ modules/
│  ├─ auth/               # login, refresh, logout, me
│  ├─ users/              # users, roles, invitations
│  ├─ sites/              # construction sites
│  ├─ workers/            # workers + worker docs
│  ├─ attendance/         # attendance, vacation, disease, working hours
│  ├─ salary/             # SalaryRuleEngine + strategies (§4)
│  ├─ finance/            # loans, advance payments
│  ├─ requests/           # vacation/loan/advance approval workflow
│  ├─ reports/            # PDF generation (§7)
│  ├─ billing/            # customers/usage/P&L                 [future]
│  └─ health/             # /health (server) + /health/db      (Back Office dashboard)
└─ lib/                   # shared server utils (dates, money, pagination)
```

Layering inside a module: `routes → service → repository (Prisma)`. Routes validate via shared Zod schema, delegate to service (business logic), which uses repository (data access). No cross-module DB access — modules call each other via service interfaces.

### 3.2 API style — REST, versioned, route groups

Base: `/api/v1`. JSON. Auth via `Authorization: Bearer <access>`. Standard error envelope `{ error: { code, message, details? } }`.

```
POST   /api/v1/auth/login | /refresh | /logout        GET /auth/me
GET    /api/v1/users        POST /users               (RBAC: Admin/Manager)
GET    /api/v1/sites        POST/PATCH/DELETE /sites/:id
GET    /api/v1/workers      POST/PATCH /workers/:id
GET/POST /api/v1/workers/:id/docs
GET/POST /api/v1/attendance          (query: siteId, workerId, from, to)
GET/POST /api/v1/working-hours
GET    /api/v1/salary/calculate      (query: workerId, period; strategy resolved server-side)
GET/POST /api/v1/loans   |  /advances
GET/POST /api/v1/requests            PATCH /requests/:id/approve | /reject
GET    /api/v1/reports/:type.pdf     (streams PDF)
GET    /health   |  /health/db       (unauthenticated, for uptime + BO dashboard)
```

### 3.3 Front-end structure (Manager web + app + shared)

```
Frontend/manager/web/src/
├─ app/            # router, providers (QueryClient, Theme, i18n, Auth)
├─ features/       # mirror back-end domains: sites/ workers/ attendance/ salary/ requests/
│  └─ <feature>/   # api hooks (React Query) + components + screens
├─ lib/api/        # typed fetch client bound to @sitelink/shared contract
├─ components/     # web-local components (or from @sitelink/ui-web)
└─ i18n/           # binds @sitelink/i18n

Frontend/manager/app/  (Expo)
├─ app/            # expo-router file routes, providers
├─ features/       # SAME feature names as web → parallel structure
├─ lib/api/        # shares the typed client contract from @sitelink/shared
└─ ...
```

**Shared between web + app:** all types/DTOs/Zod/enums (`@sitelink/shared`), the API-client *contract* + React Query key factories, i18n resources (`@sitelink/i18n`), and theming tokens. **Not shared:** rendering primitives (DOM vs native) — kept in `ui-web` / `ui-native` with a common token contract so both consume the same design tokens (§6).

---

## 4. SalaryRuleEngine — Interface & Strategy Design

Strategy pattern. The engine selects a strategy per worker/site/tenant config; calculation is pure and deterministic given inputs. Lives in `backend/src/modules/salary`, with the interface + input/output DTOs mirrored in `@sitelink/shared`.

```ts
// @sitelink/shared — contract
export enum SalaryStrategyId {
  FLAT = "FLAT",
  ISRAELI_LABOR_LAW = "ISRAELI_LABOR_LAW",
}

export interface SalaryPeriod { from: string; to: string; } // ISO dates

export interface SalaryInput {
  workerId: string;
  period: SalaryPeriod;
  baseRate: number;            // hourly or monthly per contract
  rateType: "HOURLY" | "MONTHLY";
  workedHours: WorkedHours[];  // per-day: regular, overtime buckets, night, holiday
  absences: Absence[];         // vacation / disease / unpaid
  deductions: Deduction[];     // loans, advances repayments
  currency: string;
}

export interface SalaryLineItem { code: string; label: string; amount: number; meta?: Record<string, unknown>; }

export interface SalaryResult {
  workerId: string;
  period: SalaryPeriod;
  strategy: SalaryStrategyId;
  gross: number;
  deductionsTotal: number;
  net: number;
  lineItems: SalaryLineItem[]; // fully itemized for PDF payslip
  warnings: string[];          // e.g. "overtime cap exceeded"
}

export interface SalaryRuleEngine {
  readonly id: SalaryStrategyId;
  calculate(input: SalaryInput): SalaryResult;
}
```

```ts
// backend — implementations
export class FlatSalaryStrategy implements SalaryRuleEngine {
  readonly id = SalaryStrategyId.FLAT;
  calculate(input: SalaryInput): SalaryResult { /* rate * hours (or monthly), minus deductions */ }
}

export class IsraeliLaborLawStrategy implements SalaryRuleEngine {
  readonly id = SalaryStrategyId.ISRAELI_LABOR_LAW;
  // STUB in v1: overtime tiers (125%/150%), rest-day, holiday multipliers, sick/vacation accrual.
  calculate(input: SalaryInput): SalaryResult { /* TODO: real Israeli rules; stub delegates to flat + warning */ }
}

// Resolver — chooses strategy from config (worker/site/tenant), never hard-coded at call site
export class SalaryEngineFactory {
  private readonly registry: Record<SalaryStrategyId, SalaryRuleEngine>;
  resolve(id: SalaryStrategyId): SalaryRuleEngine { return this.registry[id]; }
}
```

Swappability: adding a strategy = implement the interface + register in the factory. Route `GET /salary/calculate` resolves the strategy id from stored config, not from the request → callers never pick the algorithm.

---

## 5. Auth & RBAC Model (Supabase Auth + app-side RBAC)

**Split of responsibility.** Authentication (identity) is owned by **Supabase Auth**; authorization (what you may do) is owned by the **Fastify back end**. This replaces the earlier "issue our own JWT + rotating refresh" design — we no longer mint credentials or run refresh rotation ourselves — while keeping the role matrix, `requireRole` hook, and site-scoping exactly as before.

### 5.1 Authentication — owned by Supabase Auth

- **What Supabase owns:** user signup/invite, email+password credentials, session issuance (**Supabase-issued JWTs**), token refresh, and password reset. No credential hashing or refresh-rotation code lives in our service anymore.
- **Clients authenticate directly with Supabase.** Both **web** (Manager web) and **native** (Expo) use the **Supabase client SDK** to sign in and to hold/refresh the session (SDK persists it: secure storage / SecureStore on native, storage on web). Clients attach the Supabase access token as `Authorization: Bearer <supabase-jwt>` on every call to our API.
- **No password column.** Credentials live in Supabase Auth, not in our `User` table. This is greenfield (no data to migrate), so `User` has no `passwordHash` field at all — the app never sees passwords.

### 5.2 Authorization — owned by the Fastify back end (single boundary)

- The back end **verifies every Supabase JWT** on each request — signature via the project **JWKS / JWT secret** (`SUPABASE_JWT_SECRET` / JWKS endpoint), plus `exp`/`aud`/`iss` checks. The auth plugin extracts the Supabase auth user id (`sub`).
- It then **looks up the app-level `User` row** keyed by that Supabase auth user id to resolve **role + site-scope**. Roles and scoping are **application data**, never trusted from client-supplied claims.
- **RBAC enforcement is unchanged:** Fastify `preHandler` hook `requireRole(...roles)` per route + resource-scoping in the service layer (e.g. Foreman/Worker limited to their site/self). Permission matrix stays data (`role → permission[]`).
- **RLS is NOT the authorization boundary in v1.** All clients go through the Fastify service (they never talk to Postgres directly), so the service is the single authz point. Supabase RLS stays **off by default**, documented as available for future defense-in-depth if a client is ever pointed at Postgres/PostgREST directly.

### 5.3 User ↔ Supabase mapping (the FK)

- Each app `User` row is keyed to its Supabase auth user by storing the **Supabase auth user id** (`authUserId`, unique). This id is the join between the verified JWT `sub` and our role/site-scope data.
- `email` stays on the `User` row (mirrors Supabase) for display/lookups; Supabase remains the source of truth for the credential itself.

### 5.4 User provisioning — dual-write (Users Manager)

The Users Manager flow (Manager creates Foreman/Worker/Partner/Admin — FR-MGR-USER) provisions across **two systems in one operation**:

1. **Supabase Admin API** (`admin.createUser` / invite) — called server-side by the back end using the **service-role key** (never exposed to clients). Creates the identity and, for invites, sends the email. Returns the Supabase auth user id.
2. **App `User` row** — written with `role`, `primarySiteId`/site-scope, `language`, `theme`, and `authUserId` = the id returned in step 1.

**Consistency:** the dual-write is orchestrated by the back end and treated as one unit of work — create in Supabase first (get the id), then insert the `User` row; if the row insert fails, the back end **rolls back by deleting the just-created Supabase user** (compensating action) so no orphaned identity is left. The Supabase auth user id is the FK, so the two records are unambiguously linked. Lockout (`isLockedOut`) is enforced in our authz layer and mirrored to Supabase (ban/disable) so a locked user cannot obtain a session.

### 5.5 Session lifecycle

- **Login / refresh / password reset:** handled by Supabase (SDK on the client). Our former `/auth/login` `/refresh` `/logout` endpoints are no longer credential endpoints; `GET /auth/me` remains and returns the **app** profile (role, site-scope, prefs) for the verified Supabase user.
- **Logout** is a Supabase SDK sign-out on the client; the back end holds no server-side session state.

### 5.6 Roles & scope (unchanged)

Roles: `ADMIN`, `MANAGER`, `PARTNER`, `FOREMAN`, `WORKER`. **v1:** only Manager (and Admin) surfaces authenticate; Foreman/Worker roles exist in the model but their apps are future. Approval workflow endpoints (`/requests/:id/approve`) are Manager/Admin-gated now, Worker-initiated later.

```
Role      | Sites | Workers | Salary | Requests(approve) | Billing
ADMIN     |  all  |  all    |  yes   |  yes              |  yes
MANAGER   |  all  |  all    |  yes   |  yes              |  read
PARTNER   |  read |  read   |  read  |  no               |  read
FOREMAN   | own   | own-site| no     |  no  (initiate)   |  no
WORKER    |  -    |  self   | self   |  no  (initiate)   |  no
```

---

## 6. i18n / RTL & Theming (web + native)

- **i18next** with shared resource bundles in `@sitelink/i18n`: locales `he` (RTL), `en`, `tr` (LTR). Keys namespaced by domain.
- **Direction:** derive `dir` from active locale. Web: set `document.dir` + logical CSS properties (`margin-inline-start`, etc.) so one stylesheet serves both directions. Native: `I18nManager.forceRTL()` (requires reload on native — handle at app boot), plus logical style props.
- **Theming:** a single **design-token contract** in `@sitelink/shared` (or `ui-*` packages) — color/spacing/typography tokens with `light` + `dark` variants. Web binds tokens to CSS variables; native binds via a Theme provider. Same token names both sides → design parity. Theme + direction are React context providers at each app root.

---

## 7. PDF Generation

- **Server-side** in `reports` module using **`@react-pdf/renderer`** — JSX-defined document templates (payslips, attendance summaries, P&L) rendered to a stream. Chosen over headless-Chromium (heavy on Railway) and client-side (inconsistent across web/native, no shared template). Templates are React components → reuse i18n + tokens.
- Route `GET /api/v1/reports/:type.pdf` streams `application/pdf`; RBAC-gated; data assembled by domain services (e.g. payslip pulls from `SalaryResult`). Locale + direction passed as query params for RTL payslips.

---

## 7a. File Storage (Supabase Storage — worker images & docs)

Worker profile images (`Worker.image` FileRef) and worker documents (`WorkerDoc`: `PASSPORT_ID`, `VISA`, `HEIGHT_PERMIT`, `ATTAT` — images/PDF) are **PII / immigration documents**. They live in **Supabase Storage**, never in the database and never in a public bucket.

- **Private buckets only:** `worker-images` and `worker-docs`. Both are **private** — there are no public URLs. `HEIGHT_PERMIT`, `VISA`, and `ATTAT` are especially sensitive (immigration/permit data) and get the same private treatment as everything else; nothing is world-readable.
- **DB stores the key, not the bytes.** The existing `FileRef` fields are the storage path/key + metadata: `Worker.imageStorageKey/imageFileName/imageMimeType/imageUploadedAt` and `WorkerDoc.storageKey/fileName/mimeType/sizeBytes/uploadedAt`. The object bytes live only in Supabase Storage.
- **The Fastify service is the access gate.** Clients never hold the storage service-role key and never mint their own URLs. Every upload/download is authorized by the back end (`requireRole` + resource-scoping — same authz path as the rest of the API) before any signed URL is issued.

**Upload flow:**
1. Client requests an upload for a given worker/doc-type; back end **authorizes** (role + site-scope) and **validates intent** (allowed MIME type — image/* or application/pdf per doc type — and max size).
2. Back end returns a **short-lived signed upload URL** (Supabase `createSignedUploadUrl`) scoped to a server-chosen key, e.g. `worker-docs/<workerId>/<docType>/<uuid>.<ext>`. (For small profile images the back end may instead proxy the bytes through itself; signed-upload is preferred for larger doc scans to avoid tying up the API.)
3. Client uploads directly to Supabase using that URL. Client then confirms; back end **re-validates** the stored object's content-type/size and **writes/updates the FileRef row** (`storageKey`, `fileName`, `mimeType`, `sizeBytes`, `uploadedAt`). The FileRef is only persisted after a successful, validated upload.

**Download flow:**
1. Client requests a worker image/doc; back end **authorizes**, reads the `storageKey` from the FileRef row, and mints a **short-lived signed read URL** (`createSignedUrl`, seconds-to-minutes TTL).
2. Client fetches the object directly from Supabase with that URL; the URL expires quickly so links can't be shared or leaked long-term.

**Validation & hardening:** enforce an allow-list of MIME types and a max file size at the back end (reject on mismatch); server-generated object keys (never client-supplied paths) to prevent traversal/overwrite; delete objects when a `WorkerDoc` is removed or a `Worker` is archived-then-purged, keeping DB refs and storage in sync. Encryption in transit is TLS to Supabase; encryption at rest is provided by Supabase's managed storage.

---

## 8. Non-Functional Design

- **Env config:** each package reads a **Zod-validated** config at boot (fail-fast on missing vars). `.env.example` documents the full surface. Never commit secrets; Vercel/Railway/Supabase project env vars hold real values. Back end reads `DATABASE_URL` (Supabase **pooler**, port 6543, `?pgbouncer=true`) for the runtime client and `DIRECT_URL` (Supabase **direct**, port 5432) for migrations.
- **Supabase env surface** (per environment, secrets never in repo):
  - **Clients (web + native), publishable:** `SUPABASE_URL` (project URL) and `SUPABASE_ANON_KEY` — exposed as `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` (web) and `EXPO_PUBLIC_SUPABASE_URL`/`EXPO_PUBLIC_SUPABASE_ANON_KEY` (native). Used by the Supabase SDK for auth + direct signed-URL object transfer.
  - **Back end only, secret:** `SUPABASE_SERVICE_ROLE_KEY` (Admin API for user provisioning + minting signed Storage URLs) and `SUPABASE_JWT_SECRET` (or the project **JWKS** endpoint) for verifying incoming Supabase JWTs. `SUPABASE_URL` is also read server-side. **The service-role key never leaves the back end** and is never sent to any client (guideline: no keys/secrets exposed).
- **Migrations:** Prisma Migrate against Supabase. `migrate dev` locally; `migrate deploy` in the Railway release step (pre-start) using `DIRECT_URL`. One migration history; never edit applied migrations. **Prisma 7 note:** connection URLs are NOT in `schema.prisma` (Prisma 7 removed `datasource.url`/`directUrl` from the schema) — they live in `backend/prisma.config.ts` (`datasource.url` = pooler, `datasource.directUrl` = direct); the runtime `PrismaClient` uses a `pg` driver adapter on `DATABASE_URL`.
- **Health:** `/health` (process/liveness) + `/health/db` (runs `SELECT 1` against Supabase, returns latency) — unauthenticated, consumed by uptime checks and the future Back Office dashboard.
- **Logging:** Fastify + **pino** structured JSON logs with request-id correlation; error-handler plugin maps thrown errors → standard envelope + appropriate status; no PII in logs.
- **Testing:** Vitest across packages; API integration tests against a disposable Postgres (Testcontainers) or a dedicated Supabase test project/branch.

---

## 9. Deploy Topology (Vercel + Railway + Supabase)

Clean CI/deploy boundary: **front ends → Vercel, back end → Railway, managed Postgres → Supabase.** They never share a deploy unit; the contract between them is `@sitelink/shared` + the REST API + env-injected base URLs. The back end is the only thing that talks to the database.

```
                         ┌─────────────────────────────────────────┐
                         │                 VERCEL                   │
   Manager Web (Vite) ───┤  static SPA build, per-app project       │
   BackOffice Web (fut) ─┤  env: VITE_API_BASE_URL                  │
                         └──────────────────┬──────────────────────┘
                                            │  HTTPS /api/v1
   Manager App (Expo) ──── EAS build/OTA ───┤  env: EXPO_PUBLIC_API_BASE_URL
   Foreman/Worker (fut) ──────────────────  │
                                            ▼
                         ┌─────────────────────────────────────────┐
                         │                 RAILWAY                  │
                         │  @sitelink/backend (Fastify)             │
                         │   release: prisma migrate deploy         │
                         │   env: DATABASE_URL (pooler),            │
                         │        DIRECT_URL (migrations),          │
                         │        SUPABASE_URL, SERVICE_ROLE_KEY,   │
                         │        SUPABASE_JWT_SECRET/JWKS, LOG_LVL │
                         └──────────────────┬──────────────────────┘
                                            │  Postgres wire (TLS)
                                            ▼
                         ┌─────────────────────────────────────────┐
                         │                SUPABASE                  │
                         │  managed PostgreSQL                      │
                         │   • pooler (PgBouncer) :6543 → runtime   │
                         │   • direct            :5432 → migrations │
                         │   • PITR backups, SQL editor             │
                         │  Auth  → sessions/JWT (clients + verify) │
                         │  Storage → worker-images / worker-docs   │
                         │  (RLS / Realtime / Edge: deferred)       │
                         └─────────────────────────────────────────┘
```

Note: clients also talk to Supabase directly for **Auth** (SDK sign-in/refresh) and for **Storage object transfer** via back-end-minted signed URLs; all *application* data and authorization still flow only through the Fastify back end.

### Supabase usage summary

| Supabase capability | v1 | Notes |
|---|---|---|
| **Database** (Postgres) | **Yes** | Prisma-owned schema/migrations; pooler runtime + direct for migrate. |
| **Auth** | **Yes** | Owns authentication (sessions/JWT); back end verifies JWT, app owns RBAC/site-scope (§5). |
| **Storage** | **Yes** | Private `worker-images` / `worker-docs` buckets; back-end-authorized signed URLs (§7a). |
| **RLS (as authz)** | **Deferred** | Off by default; Fastify is the single authorization point. Available as future defense-in-depth. |
| **Realtime** | **Deferred** | Not used in v1. |
| **Edge Functions** | **Deferred** | Not used in v1; all logic in the Fastify service. |

- **Environment boundaries:** `local` (docker Postgres) → `preview` (per-PR Railway env + Vercel preview + a Supabase preview branch or dedicated test project) → `production` (Supabase production project). Secrets per-environment, never in repo.
- **CI:** Turborepo pipeline on PR — `typecheck`, `lint`, `test`, `build` (only affected packages). Merge to main triggers Railway backend deploy (with `migrate deploy`) and Vercel front-end deploys independently. Expo apps ship via EAS on tagged releases.

---

## 10. Build Order — v1 Vertical Slice (Manager + back end)

1. **Monorepo foundation** — pnpm workspace, Turborepo, `tsconfig.base`, `@sitelink/shared` skeleton (enums, base DTOs, Zod).
2. **Back-end core** — Fastify app, config (Zod), pino logger, error envelope, Prisma init, `/health` + `/health/db`.
3. **Data model** — Prisma schema for Users/Roles, Sites, Workers + Docs, Attendance/WorkingHours, Loans/Advances, Requests. First migration.
4. **Auth + RBAC** — Supabase JWT-verify plugin (JWKS/secret), app `User` lookup by `authUserId`, `GET /auth/me`, `requireRole` hook, role matrix; user provisioning via Supabase Admin API + dual-write to `User` (§5.4).
5. **Sites + Workers domains** — CRUD end-to-end (routes→service→repo) with shared DTOs.
6. **Attendance / Working Hours** — capture + query.
7. **Salary engine** — interface, `FlatSalaryStrategy`, `IsraeliLaborLawStrategy` stub, factory, `/salary/calculate`.
8. **Requests workflow** — create + approve/reject (Manager-gated).
9. **Reports** — payslip + attendance PDF via `@react-pdf/renderer`.
10. **Manager Web (Vite)** — auth flow, providers (Query/Theme/i18n), Sites → Workers → Attendance → Salary → Requests features against the API.
11. **Manager App (Expo)** — same features, sharing `@sitelink/shared`, i18n, tokens; native-specific screens.
12. **i18n/RTL + theming pass** — he/en/tr, dark/light across both surfaces.
13. **Deploy** — Supabase Postgres (provision project, set pooler/direct URLs), Railway backend, Vercel manager-web, EAS manager-app; wire env boundaries + CI.

Foreman/Worker/Back Office surfaces slot into steps 5–12's existing module + feature structure when their phase begins — no architectural change required.
