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
- PostgreSQL + one ORM.
- Salary via swappable `SalaryRuleEngine` (Strategy).
- Hosting: Vercel (front ends) + Railway (back end + Postgres).
- v1 scope: Manager surfaces + back end only.

---

## 1. Chosen Stack & Justifications

| Concern | Pick | Justification |
|---|---|---|
| Monorepo | **pnpm workspaces + Turborepo** | pnpm's content-addressed store + strict `node_modules` avoids phantom deps across web/native/backend; Turborepo gives cached, dependency-aware task graph (`build`, `lint`, `test`, `typecheck`). Best-in-class for a TS monorepo mixing Expo + web + Node. |
| Web front end | **Vite + React (SPA)** for Manager web | Manager web is an authenticated internal dashboard, not a public SEO/marketing site. Vite gives the fastest dev loop and simplest static-build deploy to Vercel. Next.js would add SSR/routing weight we don't need and would blur the "single back end" boundary (we explicitly do NOT want API routes here — see back end). If public marketing/SEO surfaces appear later, add a separate Next.js app; do not retrofit. |
| Native front end | **Expo (React Native)** | Managed workflow → OTA updates, EAS build, no native toolchain babysitting. Shares TS + business logic with web via workspace packages. |
| Back end | **Standalone Fastify service** (Node, TypeScript) | Chosen over Next.js API routes: we need ONE back end serving 5 heterogeneous clients (2 web + 3 native), long-running concerns (PDF gen, cron-style payroll), and clean deploy to Railway independent of Vercel front-end deploys. Fastify over Express: native TS types, schema-based validation (JSON Schema / Typebox), faster, first-class plugin/encapsulation model that maps cleanly to our module boundaries. |
| ORM | **Prisma** | Type-safe client generated from a single schema → feeds our `shared-types` philosophy; first-class migrations (`prisma migrate`); excellent Postgres support; readable schema is a strong onboarding + design artifact. Trade-off (raw-SQL ergonomics for complex payroll aggregation) mitigated by Prisma's `$queryRaw` escape hatch where the salary engine needs window functions. |
| Auth | **JWT access + refresh, RBAC** | Stateless access tokens fit multi-client (native + web); refresh rotation for session longevity. Details in §5. |
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
│     └─ web/        # @sitelink/backoffice-web (Vite+React)     [future]
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

## 5. Auth & RBAC Model

- **Tokens:** short-lived JWT access (~15 min) + long-lived rotating refresh (httpOnly cookie for web; secure storage / SecureStore for native). Refresh rotation with reuse detection.
- **Roles:** `ADMIN`, `MANAGER`, `PARTNER`, `FOREMAN`, `WORKER`. Encoded in JWT claims (`sub`, `role`, optional `siteScope`).
- **RBAC enforcement:** Fastify `preHandler` hook `requireRole(...roles)` per route + resource-scoping in service layer (e.g. Foreman/Worker limited to their site/self). Permission matrix is data (`role → permission[]`) so it evolves without code changes.
- **v1:** only Manager (and Admin) surfaces authenticate; Foreman/Worker roles exist in the model but their apps are future. Approval workflow endpoints (`/requests/:id/approve`) are Manager/Admin-gated now, Worker-initiated later.

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

## 8. Non-Functional Design

- **Env config:** each package reads a **Zod-validated** config at boot (fail-fast on missing vars). `.env.example` documents the full surface. Never commit secrets; Vercel/Railway project env vars hold real values.
- **Migrations:** Prisma Migrate. `migrate dev` locally; `migrate deploy` in Railway release step (pre-start). One migration history; never edit applied migrations.
- **Health:** `/health` (process/liveness) + `/health/db` (runs `SELECT 1`, returns latency) — unauthenticated, consumed by uptime checks and the future Back Office dashboard.
- **Logging:** Fastify + **pino** structured JSON logs with request-id correlation; error-handler plugin maps thrown errors → standard envelope + appropriate status; no PII in logs.
- **Testing:** Vitest across packages; API integration tests against a disposable Postgres (Testcontainers or Railway preview DB).

---

## 9. Deploy Topology (Vercel + Railway)

Clean CI/deploy boundary: **front ends → Vercel, back end + DB → Railway.** They never share a deploy unit; the contract between them is `@sitelink/shared` + the REST API + env-injected base URLs.

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
                         │   env: DATABASE_URL, JWT_*, LOG_LEVEL    │
                         │        ┌──────────────┐                  │
                         │        │  PostgreSQL  │  (Railway plugin)│
                         │        └──────────────┘                  │
                         └─────────────────────────────────────────┘
```

- **Environment boundaries:** `local` (docker Postgres) → `preview` (per-PR Railway env + Vercel preview) → `production`. Secrets per-environment, never in repo.
- **CI:** Turborepo pipeline on PR — `typecheck`, `lint`, `test`, `build` (only affected packages). Merge to main triggers Railway backend deploy (with `migrate deploy`) and Vercel front-end deploys independently. Expo apps ship via EAS on tagged releases.

---

## 10. Build Order — v1 Vertical Slice (Manager + back end)

1. **Monorepo foundation** — pnpm workspace, Turborepo, `tsconfig.base`, `@sitelink/shared` skeleton (enums, base DTOs, Zod).
2. **Back-end core** — Fastify app, config (Zod), pino logger, error envelope, Prisma init, `/health` + `/health/db`.
3. **Data model** — Prisma schema for Users/Roles, Sites, Workers + Docs, Attendance/WorkingHours, Loans/Advances, Requests. First migration.
4. **Auth + RBAC** — login/refresh/me, JWT plugin, `requireRole` hook, role matrix.
5. **Sites + Workers domains** — CRUD end-to-end (routes→service→repo) with shared DTOs.
6. **Attendance / Working Hours** — capture + query.
7. **Salary engine** — interface, `FlatSalaryStrategy`, `IsraeliLaborLawStrategy` stub, factory, `/salary/calculate`.
8. **Requests workflow** — create + approve/reject (Manager-gated).
9. **Reports** — payslip + attendance PDF via `@react-pdf/renderer`.
10. **Manager Web (Vite)** — auth flow, providers (Query/Theme/i18n), Sites → Workers → Attendance → Salary → Requests features against the API.
11. **Manager App (Expo)** — same features, sharing `@sitelink/shared`, i18n, tokens; native-specific screens.
12. **i18n/RTL + theming pass** — he/en/tr, dark/light across both surfaces.
13. **Deploy** — Railway backend + Postgres, Vercel manager-web, EAS manager-app; wire env boundaries + CI.

Foreman/Worker/Back Office surfaces slot into steps 5–12's existing module + feature structure when their phase begins — no architectural change required.
