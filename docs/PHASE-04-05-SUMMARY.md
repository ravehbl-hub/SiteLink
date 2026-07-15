# SiteLink — Phase 04 & 05 Summary

**Purpose:** hand-off state for the next session. Captures what shipped, architecture decisions, gate results, and open TODOs.

**Status at write time:** all work committed on local `main` (then pushed to `origin/main`). Promotion NOT done. Back-end live suite: **76 passed / 0 skipped / 0 failed** against the real Supabase project (DB + Auth + Storage).

---

## 1. What shipped

### Phase 04 — Verify & Wire + P&L + auth
- **P&L Manager (FR-MGR-PNL / SM-6):** Manager-web P&L screen wired to `GET /profit-loss`; `GET /reports/profit-loss.pdf` (RTL/LTR) added. Closed the release-blocking SM-6 gap.
- **ES256/JWKS auth:** the real Supabase project issues **ES256** session tokens; the back end only verified HS256. Fixed `backend/src/plugins/auth.ts` to verify ES256 via project JWKS (`createRemoteJWKSet` on `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`, issuer+audience pinned) **with the HS256 / `SUPABASE_JWT_SECRET` path kept as a fallback** (so forged-HS256 tests still pass). Real end-user login now returns 200 on `/auth/me`.
- **Live integration tests (76/0):** all 10 previously-skipped live tests in `backend/test/integration-live-db.test.ts` implemented and passing against real Supabase — including **test #9** (worker-docs signed upload/read URLs, private bucket) once the Storage bucket existed.

### Phase 05 — three new front-end surfaces + supporting back end
- **Foreman app** (`Frontend/Foreman/app`, `@sitelink/foreman-app`): Expo SDK 54, drawer nav v7. Own-site-scoped (`User.primarySiteId`, no site picker). Screens: Login, site Dashboard (+Data/Graphics charts), Attendance (own-site), Worker Rating (1–5), Reports, Settings.
- **Worker app** (`Frontend/Worker/app`, `@sitelink/worker-app`): Expo SDK 54, drawer nav v7. Self-scoped (via `Worker.userId`). Screens: Login, Working Hours (+PDF), Salary (+payslip PDF), New Request (unified Vacation/Loan/Advance), My Requests, Settings.
- **BackOffice web** (`Frontend/system-admin/web`, `@sitelink/system-admin-web`): Vite, **ADMIN-only**, vertical menu (LR/RL by language, FR-X-I18N-6). Screens: Login, Dashboard (system status + P&L + users), Users Activity, Bookkeeping (P&L + PDF; Excel = future), Settings. **Customers/Billing/Usage = clearly-labeled "coming soon" UI stubs (no schema, no logic).**
- **Manager dashboard charts (web + app):** Data ↔ Graphics toggle; real charts (bar per-site, donut attendance breakdown, bar revenue-vs-costs) from the existing `DashboardRollup`. Web = inline SVG (no dep); app = `react-native-svg`.
- **Expo SDK 51 → 54 upgrade** across all apps + **React Navigation v6 → v7** (v6 drawer crashed under Reanimated 4 via the removed `useLegacyImplementation`). New Architecture on; `react-native-worklets` + babel `react-native-worklets/plugin`.
- **WorkerRating** table (per-event, per-foreman, 1–5 score; distinct from `Worker.level`) + endpoints.
- **Worker request approval loop (FR-REQ):** worker submits via unified `POST /requests` → ADMIN/MANAGER `PATCH /requests/:id/approve|reject` → transactional side-effects (approved VACATION → attendance days, LOAN → Loan, ADVANCE → AdvancePayment; failed effect rolls back status).
- **Worker.userId linking:** nullable unique FK `Worker.userId → User.id` (onDelete SET NULL); optional create-time dual-write (`POST /workers` `login{}` block provisions a Supabase WORKER identity + `User` row + links `Worker.userId`, with compensating rollback).
- **RLS defense-in-depth:** RLS ENABLED on all app tables, deny-by-default (see §2).
- **Private Storage buckets:** `worker-images` + `worker-docs` provisioned (private) via `backend/scripts/provision-storage.ts`.
- **RN upload fix:** worker image/doc upload used `fetch(uri).blob()` → PUT (fails on RN/Hermes "Network request failed"). Switched to `expo-file-system/legacy` `uploadAsync` (BINARY_CONTENT). Manager app fixed; new apps use the correct pattern.

---

## 2. Architecture notes (authoritative)

- **The back end is the single authorization boundary** (PRD FR-X-RBAC-2). Roles + site/self scoping are resolved from the JWT-verified `User` row, enforced server-side.
- **RLS = defense-in-depth ONLY, not authz.** All app tables have RLS **enabled with ZERO policies** = deny-by-default: a direct anon/authenticated Postgres/PostgREST client gets nothing. The app connects as `postgres` (BYPASSRLS + table owner), so the service is unaffected. **This is deliberate — "no RLS policies" is the locked-down state, not a bug.** Per-user `auth.uid()` policies (Option B) were explicitly NOT done. Storage `storage.objects` is likewise RLS-on/0-policy (deny-by-default); the back end mints signed URLs with the service-role key (which bypasses RLS).
- **Worker ↔ User link** is the 1:1 FK `Worker.userId` (migration `20260713200000`). Worker self-scoping NEVER uses `Worker.email` (nullable, non-unique — leak-prone).
- **Scope funnels through `backend/src/lib/scope.ts`** — the single security-boundary module: `resolveSiteScope`, `effectiveSiteId`, `assertWorkerInScope`, `resolveWorkerId`, `requireWorkerId`. Foreman → own `primarySiteId` (fail-closed on null → 403/empty); Worker → own worker via `Worker.userId` (fail-closed if unlinked). Server-derived actor ids (`foremanId`/`requestedById`/`resolvedById`) are never client-settable.
- **Auth:** ES256-via-JWKS primary + HS256 fallback in `backend/src/plugins/auth.ts`.
- **`/auth/me`** returns the app profile MINUS `authUserId` (data minimization; clients don't need the Supabase identity FK).

---

## 3. Gate results (all PASS/SAFE; nothing promoted)

| Surface | bugo (functional) | nexo (security) |
|---|---|---|
| Back end (Stage B) | PASS — 76/0 live | PASS — role boundary safe, no CRITICAL/HIGH |
| Foreman app | PASS (after FR-FOR-5 rating `date` fix) | SAFE — no CRITICAL/HIGH/MEDIUM |
| Worker app | PASS | SAFE — no CRITICAL/HIGH/MEDIUM |
| BackOffice web | PASS (vertical-menu RTL verified) | SAFE — no CRITICAL/HIGH/MEDIUM |
| Manager dashboard charts (web + app) | PASS (bugo-web + bugo-app) | — |

Nexo LOW notes (addressed): `/auth/me` `authUserId` trimmed; error envelopes confirmed generic.

---

## 4. OPEN TODOs (next session)

- **Promotion NOT done.** Plato (sandbox) / Gateway / Forge (production) untouched. No deploy performed. All surfaces are gate-passed and awaiting a promotion decision.
- **⚠️ Supabase secrets UN-ROTATED.** Early in the session the real `SUPABASE_SERVICE_ROLE_KEY` + `SUPABASE_JWT_SECRET` (+ anon key, project ref `vtyoyqit…`) were briefly written by an agent into a OneDrive-synced tracked template file; reverted immediately and confirmed **never committed to git history**. Because the working dir is cloud-synced, **the user should rotate the service-role key + JWT secret in the Supabase dashboard** as a precaution. NOT rotated by us (would break the live env mid-work). If rotated, update git-ignored `backend/.env`.
- **Partner role deferred** — no Partner surface / Partner-specific access built this phase.
- **Billing/Customers/Usage UI-stubbed** — BackOffice shows "coming soon" stubs; no Customer/Tenant/Subscription/UsageEvent schema or logic. (Tables `Customer/Billing/Usage/BusinessProfitLoss` exist in schema but are unused this phase.) Users-Activity is basic (from the `User` table); no audit/event-log subsystem.
- **On-device retests pending:** (a) Manager app image/doc upload after the `expo-file-system` fix (needs `expo start -c` in Expo Go, or a rebuilt dev client if custom); (b) Foreman/Worker apps drawer + RTL + charts on device; (c) worker-docs signed-URL upload end-to-end from a device.
- **Working-hours PDF (Excel)** — BackOffice bookkeeping ships PDF; Excel export labeled future.
- **Minor:** BackOffice web pins React 18.3 (not 19); builds green — align if strict parity wanted. Single-chunk bundle advisory (consider lazy routes/manualChunks).

---

## 5. Helpers & test fixtures

- **`backend/scripts/link-auth-user.ts`** — reconciles a seeded app `User` row's `authUserId` to its real Supabase Auth identity (reads `SUPABASE_SERVICE_ROLE_KEY` from env). Used to make seeded users loginable for golden-paths.
- **`backend/scripts/provision-storage.ts`** — idempotently creates the private `worker-images` / `worker-docs` buckets (reads keys from env; no secrets in source).
- **Test users:** the live gate suites provision ADMIN / MANAGER / FOREMAN / WORKER Supabase identities via `POST /users` dual-write (+ link helper) and tear them down in `afterAll` (0 residual identities). Seed data persists; test data is cleaned up.
- **Gate suites:** `backend/test/phase05-stageB.test.ts` (role-scoping + FR-FOR/FR-WRK/FR-BO + request loop) and `backend/test/integration-live-db.test.ts` (10 live DB/Auth/Storage tests, incl. #9).

---

## 6. Commit trail (Phase 04/05, local `main`)

Phase 04: P&L (`61d0814`) → ES256 auth + 10 live tests (`86bf856`).
Phase 05: RLS defense-in-depth (`2ffdf02`) → logo (`1735402`) → SDK 54 (`5c8e6a1`) → WorkerRating schema (`b91cf5f`) → i18n Hermes fix (`58768a9`) → nav v7 (`4d5be3d`) → Stage B partial/complete/gate (`91a7709`/`4fd74d2`/`a7c310d`) → dashboard charts web+app (`4f05e72`/`15acc6b`) → hardening (`2ee510b`) → upload fix (`6058c31`) → working-hours PDF (`4a6377e`) → storage buckets + test #9 (`be9b8a0`) → Foreman/Worker/BackOffice (`e08d2d7`/`0647b3d`/`ec1a808`) → lockfile (`9ba6fcf`) → rating `date` fix (`b691436`) → nexo LOW fixes + this summary.
