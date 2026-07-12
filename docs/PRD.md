# SiteLink — Product Requirements Document (PRD)

**Phase:** 01 — Planning (CREATE build)
**Owner:** Manifest (PRD Agent)
**Date:** 2026-07-12
**Status:** Draft for Architecture handoff (Matrix)

---

## 1. Product Summary & Goals

### 1.1 Summary
SiteLink is a multi-role construction-site **workforce and finance management system**. It centralizes worker records, attendance, compensation, and site-level profit & loss across five role surfaces that share a single back end and data model. Managers get full CRUD and financial oversight; Foremen record on-site activity; Workers self-serve reports and submit requests; Back Office runs the SaaS business layer (customers, billing, bookkeeping, system health).

The product spans web (React) and mobile (React Native) clients backed by a TypeScript/Node service and PostgreSQL, with shared types across all clients.

### 1.2 Goals
- **G1 — Single source of truth** for workers, sites, hours, and pay across all roles.
- **G2 — Accurate, auditable pay computation** driven by a swappable rule engine (Israeli labor law or fixed salary).
- **G3 — Site- and date-scoped visibility** so Managers can roll up workforce and finance metrics on demand.
- **G4 — Multilingual, bidirectional UX** (Hebrew/English/Turkish, RTL/LTR) usable by a diverse on-site workforce.
- **G5 — Role-appropriate access** enforced consistently on the back end for every surface.

### 1.3 Non-Goals (product level)
- SiteLink is not an accounting suite of record; it produces P&L views and reports, not statutory filings.
- SiteLink is not a payroll disbursement/banking system in v1; it computes and reports pay, it does not pay.

---

## 2. Personas (the 5 roles)

| Role | Surface | Primary jobs |
|------|---------|--------------|
| **Manager** | Web (tab menu) + App (hamburger) | Manage workers, sites, pay rules, loans/advances, attendance; view dashboards and P&L; administer users. **Full authority within their sites.** |
| **Foreman** | App (hamburger) | On a selected site: view dashboard summaries, log attendance/vacation/disease, rate workers, view worker counts. |
| **Worker** | App (hamburger) | View own working hours and salary (PDF), request vacation/loan/advance (routed to admin). |
| **Partner** | (Reporting access; provisioned via Users Manager) | Read-oriented visibility into finance/dashboards. Access boundaries refined in Architecture. |
| **Admin / Back Office** | Web (vertical menu, LR/RL by language) | Operate the SaaS: customers, billing, usage, users activity, bookkeeping (P&L), system status. Approves Worker requests. |

**Access hierarchy (roles):** Admin ⊃ Manager ⊃ Partner (read-weighted) / Foreman / Worker. RBAC is enforced server-side (see NFR-SEC).

---

## 3. Scope

### 3.1 In scope — Build v1 (vertical slice)
- **Manager surface**: Web (React) + App (React Native).
- **Back end vertical slice**: API, auth/RBAC, PostgreSQL schema, PDF generation, and the `SalaryRuleEngine` interface (stubbed rules) — sufficient to power every Manager feature end to end.
- **Cross-cutting** for the Manager surface: dark/light theming; i18n Hebrew/English/Turkish with RTL/LTR; role-based access; PDF report export.
- **User provisioning** for all roles (Manager can create Foreman/Worker/Partner/Admin users) even though those surfaces are not built in v1 — because the Manager needs to manage the roster.

### 3.2 Out of scope — Build v1 (documented for completeness)
- **Foreman app** surface (Section 8).
- **Worker app** surface (Section 9).
- **Back Office web** surface (Section 10).
- The **request-approval workflow** UI on the Worker/Admin side. The Manager surface and back end may model request entities, but the Worker-initiated flow and Admin approval UI are v2.
- Real Israeli-labor-law salary rules. v1 ships the **interface contract plus a stub implementation** only (Section 11).
- Real billing/payment provider integration (Back Office billing is documented, not built).
- Market research (explicitly excluded from this phase).

### 3.3 Explicit v1 boundary statement
> If a requirement is prefixed `FR-MGR-*` it is **in scope for v1**. All `FR-FOR-*`, `FR-WRK-*`, `FR-BO-*` requirements are **documented but out of scope for v1 build**. Matrix should still design the data model to accommodate them.

---

## 4. Global / Cross-Cutting Requirements

### FR-X-I18N — Internationalization & Bidirectionality
- **FR-X-I18N-1** The system SHALL support three UI languages: Hebrew, English, Turkish.
- **FR-X-I18N-2** Hebrew SHALL render RTL; English and Turkish SHALL render LTR. Layout direction SHALL flip based on active language, not device locale alone.
- **FR-X-I18N-3** Language SHALL be selectable in Settings and persist per user across sessions and devices.
- **FR-X-I18N-4** All user-facing strings SHALL come from translation resources; no hard-coded display text.
- **FR-X-I18N-5** Numeric, date, and currency formatting SHALL respect the active locale.
- **FR-X-I18N-6** (Back Office, documented) The vertical navigation menu SHALL align left-to-right for LTR languages and right-to-left for Hebrew.

### FR-X-THEME — Theming
- **FR-X-THEME-1** The system SHALL offer dark and light themes, selectable in Settings.
- **FR-X-THEME-2** Theme selection SHALL persist per user and apply on next load without flash of incorrect theme.

### FR-X-RBAC — Role-Based Access Control
- **FR-X-RBAC-1** Every API request SHALL be authenticated; unauthenticated requests SHALL be rejected (401).
- **FR-X-RBAC-2** Authorization SHALL be enforced server-side by role (Admin/Manager/Partner/Foreman/Worker); client-side gating is presentation only and never the security boundary.
- **FR-X-RBAC-3** Resource access SHALL be scoped: a Manager SHALL only access sites and workers they are permitted to manage.
- **FR-X-RBAC-4** Forbidden actions SHALL return 403 with no data leakage in the response body.

### FR-X-PDF — PDF Reporting
- **FR-X-PDF-1** The system SHALL generate downloadable PDF reports for defined report types (working hours, salary, P&L).
- **FR-X-PDF-2** PDFs SHALL honor the active language and direction (RTL/LTR) at generation time.
- **FR-X-PDF-3** PDFs SHALL include site name, date range, and generation timestamp in a header.

---

## 5. Manager Surface — Functional Requirements (IN SCOPE v1)

Surface locations: Web at `Frontend/manager/web` (tab menu); App at `Frontend/manager/app` (hamburger menu). Both consume the same API.

### 5.1 Dashboard — `FR-MGR-DASH`
- **FR-MGR-DASH-1** The Dashboard SHALL default to an **all-sites** view.
- **FR-MGR-DASH-2** The Manager SHALL filter the Dashboard by **construction site** and by **date / date range**.
- **FR-MGR-DASH-3** The Dashboard SHALL roll up **Workforce** metrics for the current filter: total worker amount, attendance/vacation/disease counts, active loans, advance payments outstanding, workers per site, and aggregate work hours.
- **FR-MGR-DASH-4** The Dashboard SHALL roll up **Finance** metrics for the current filter: total salary cost and profit & loss.
- **FR-MGR-DASH-5** Changing the site or date filter SHALL update all rolled-up metrics consistently for the same filter window.
- **FR-MGR-DASH-6** When no data exists for a filter, the Dashboard SHALL show an explicit empty state (zeros/empty), not an error.

### 5.2 Employee Management — `FR-MGR-EMP`
- **FR-MGR-EMP-1** The Manager SHALL create a worker via a **Worker Wizard** that captures Worker Details, Worker Docs, and Worker Salary data.
- **FR-MGR-EMP-2** **Worker Details** SHALL capture: profile image (upload or camera), First Name, Last Name, Country, Address, Profession, Level (Weak/Medium/Good/Excellent), Quality of works, Phone, Email, Personnel company, Residence, Date of starting work.
- **FR-MGR-EMP-3** **Worker Docs** SHALL capture and store: Passport/ID (image/PDF/camera), Visa, Permit to work at height, ATTAT. Each document SHALL retain file type and upload timestamp.
- **FR-MGR-EMP-4** **Worker Salary data** SHALL capture hourly wage and working conditions.
- **FR-MGR-EMP-5** The Manager SHALL **Add, Modify, and Remove** a worker; Remove SHALL support either deletion or **move to Archives**.
- **FR-MGR-EMP-6** Archived workers SHALL be viewable in an **Archives** list and excluded from active rosters and active dashboard counts.
- **FR-MGR-EMP-7** Required fields (First Name, Last Name, Profession) SHALL be validated before save; invalid submissions SHALL surface field-level errors.
- **FR-MGR-EMP-8** Profession SHALL be selected from the controlled list: ironworker, molder, concrete worker, general laborer, foreman, mechanic, electrician, plumber, other.
- **FR-MGR-EMP-9** Level SHALL be one of: Weak, Medium, Good, Excellent.

### 5.3 Loans — `FR-MGR-LOAN`
- **FR-MGR-LOAN-1** The Manager SHALL record a loan **for a selected worker** (amount, date, optional notes).
- **FR-MGR-LOAN-2** The Manager SHALL view, modify, and remove loan records for a worker.
- **FR-MGR-LOAN-3** Outstanding loans SHALL contribute to the Dashboard workforce rollup (FR-MGR-DASH-3).

### 5.4 Advance Payment — `FR-MGR-ADV`
- **FR-MGR-ADV-1** The Manager SHALL record an advance payment **for a selected worker** (amount, date, optional notes).
- **FR-MGR-ADV-2** The Manager SHALL view, modify, and remove advance-payment records for a worker.
- **FR-MGR-ADV-3** Outstanding advances SHALL contribute to the Dashboard finance/workforce rollup.

### 5.5 Attendance / Vacation / Disease & Working Hours — `FR-MGR-ATT`
- **FR-MGR-ATT-1** The Manager SHALL record, for a selected worker, **Attendance**, **Vacation**, and **Disease** entries tied to a date.
- **FR-MGR-ATT-2** From these entries the system SHALL derive **Working Hours** views aggregated by **day, week, and month**.
- **FR-MGR-ATT-3** Working Hours totals SHALL feed the Dashboard work-hours rollup and salary calculation inputs.
- **FR-MGR-ATT-4** Attendance status for a worker/day SHALL be exclusive among the defined states (present/attendance, vacation, disease) to avoid double counting.
- **FR-MGR-ATT-5** The Manager SHALL edit and remove attendance/vacation/disease entries.

### 5.6 Payment Management — `FR-MGR-PAY`
- **FR-MGR-PAY-1** The Manager SHALL define **hourly wage by profession** for each profession in the controlled list (Section 5.2, FR-MGR-EMP-8).
- **FR-MGR-PAY-2** The Manager SHALL choose a **salary calculation mode** per applicable scope: **Israeli labor law** or **Fixed salary (flat)**.
- **FR-MGR-PAY-3** The Manager SHALL Add, Modify, and Remove wage/pay-rule records.
- **FR-MGR-PAY-4** Salary computation SHALL be produced exclusively via the `SalaryRuleEngine` (Section 11); the UI SHALL never compute pay inline.
- **FR-MGR-PAY-5** When "Israeli labor law" mode is selected in v1, the stub engine SHALL return a clearly-labeled computed result derived from hours × applicable rate (overtime/statutory rules deferred), so the flow is exercisable end to end.

### 5.7 Profit & Loss Manager — `FR-MGR-PNL`
- **FR-MGR-PNL-1** The Manager SHALL view a Profit & Loss summary scoped by site and date range.
- **FR-MGR-PNL-2** P&L SHALL derive revenue/cost inputs from salary cost, loans, and advances within scope (revenue inputs sourced per data model; see Section 12).
- **FR-MGR-PNL-3** The P&L view SHALL be exportable as a PDF (FR-X-PDF).

### 5.8 Construction-Site Manager — `FR-MGR-SITE`
- **FR-MGR-SITE-1** The Manager SHALL Add, Modify, Remove, and Archive construction sites via **Site Details**.
- **FR-MGR-SITE-2** Site Details SHALL capture at minimum a site name/identifier and status (active/archived).
- **FR-MGR-SITE-3** Archived sites SHALL be excluded from the default all-sites dashboard while remaining viewable in Archives.
- **FR-MGR-SITE-4** A worker SHALL be assignable to one or more sites; site assignment drives per-site rollups.

### 5.9 Users Manager — `FR-MGR-USER`
- **FR-MGR-USER-1** The Manager SHALL **Add a User** with: Role (Foreman/Worker/Partner/Admin), Full name (typed or selected from a list filtered by role), Construction site, Email, Password.
- **FR-MGR-USER-2** The system SHALL list users with **Edit**, **Lockout**, and **Remove** actions.
- **FR-MGR-USER-3** **Lockout** SHALL prevent the user from authenticating without deleting the account; it SHALL be reversible.
- **FR-MGR-USER-4** Email SHALL be unique per user; passwords SHALL be stored only as salted hashes (see NFR-SEC).
- **FR-MGR-USER-5** Role assigned here SHALL determine the user's server-enforced permissions (FR-X-RBAC).

### 5.10 Settings — `FR-MGR-SET`
- **FR-MGR-SET-1** Settings SHALL allow toggling **dark/light** theme (FR-X-THEME).
- **FR-MGR-SET-2** Settings SHALL allow choosing **language** Hebrew/English/Turkish (FR-X-I18N).
- **FR-MGR-SET-3** Settings SHALL expose **User profile**, **About**, and **Disconnect** (logout).
- **FR-MGR-SET-4** Disconnect SHALL invalidate the active session on the server.

---

## 6. Manager App vs Web parity — `FR-MGR-PARITY`
- **FR-MGR-PARITY-1** The Manager App (React Native, hamburger) SHALL provide the same feature domains as the Web (tab menu), against the same API.
- **FR-MGR-PARITY-2** Camera capture for worker image and docs SHALL be available on the App; Web SHALL support upload equivalents.

---

## 7. Non-Functional Requirements

### NFR-PERF — Performance
- **NFR-PERF-1** Dashboard rollups for a single site/date filter SHOULD return within 2s at expected v1 data volumes.
- **NFR-PERF-2** List views SHALL paginate or virtualize beyond a reasonable page size to bound payloads.

### NFR-SEC — Security
- **NFR-SEC-1** Passwords SHALL be stored as salted hashes (e.g., bcrypt/argon2 — algorithm chosen by Matrix); never in plaintext or reversible form.
- **NFR-SEC-2** All traffic SHALL be over TLS.
- **NFR-SEC-3** Authorization SHALL be enforced server-side on every endpoint (FR-X-RBAC).
- **NFR-SEC-4** Uploaded documents (IDs, passports, visas) SHALL be access-controlled; only authorized roles/scopes may retrieve them.
- **NFR-SEC-5** Sensitive PII SHALL not appear in logs.

### NFR-AVAIL — Reliability / Hosting
- **NFR-AVAIL-1** Front ends SHALL deploy to **Vercel**; back end and PostgreSQL SHALL deploy to **Railway**.
- **NFR-AVAIL-2** Configuration and secrets SHALL be environment-based, not committed to source.

### NFR-MAINT — Maintainability
- **NFR-MAINT-1** Web and App SHALL share a common **shared-types** package for API contracts and domain types.
- **NFR-MAINT-2** Salary logic SHALL be isolated behind `SalaryRuleEngine` so implementations swap without touching callers (Section 11).

### NFR-A11Y / UX
- **NFR-UX-1** Both themes SHALL meet reasonable contrast for on-site readability.
- **NFR-UX-2** RTL layouts SHALL mirror correctly (navigation, alignment, icons where directional).

---

## 8. Foreman Surface — Documented, OUT OF SCOPE v1 (`FR-FOR`)
Surface: App at `Frontend/Foreman/app` (hamburger).
- **FR-FOR-1** Foreman selects a construction site (Site Manager).
- **FR-FOR-2** Site Dashboard shows all-dates or date-filtered summaries: attendance/vacation/disease counts and worker amount.
- **FR-FOR-3** Reports show amount of workers.
- **FR-FOR-4** Foreman records Attendance/Vacation/Disease for workers on the site.
- **FR-FOR-5** Foreman submits Worker rating.
- **FR-FOR-6** Foreman has Settings (theme/language/profile/disconnect).

## 9. Worker Surface — Documented, OUT OF SCOPE v1 (`FR-WRK`)
Surface: App at `Frontend/Worker/app` (hamburger).
- **FR-WRK-1** Worker views own Working Hours (day/week/month) and exports a PDF report.
- **FR-WRK-2** Worker views own Salary and exports a PDF report.
- **FR-WRK-3** Worker submits a Vacation request routed to admin.
- **FR-WRK-4** Worker submits a Loan request routed to admin.
- **FR-WRK-5** Worker submits an Advance-payment request routed to admin.
- **FR-WRK-6** Worker has Settings.

## 10. Back Office Surface — Documented, OUT OF SCOPE v1 (`FR-BO`)
Surface: Web at `Frontend/backoffice/web` (vertical menu, LR/RL by language).
- **FR-BO-1** Dashboard: customers registered/left, profit & loss, construction sites, and system status (deploy/server health, database health).
- **FR-BO-2** Customers Manager: customer details, billing, usage.
- **FR-BO-3** Users Activity: events over time, event type, and search query.
- **FR-BO-4** Bookkeeping: P&L statement exportable to PDF/Excel, plus P&L management.
- **FR-BO-5** Settings.

## 10a. Request–Approval Workflow — Documented, OUT OF SCOPE v1 (`FR-REQ`)
- **FR-REQ-1** Worker-initiated requests (vacation/loan/advance) SHALL be persisted with status (pending/approved/rejected).
- **FR-REQ-2** Admin SHALL review and resolve requests; resolution updates the corresponding worker record.
- **FR-REQ-3** v1 back end MAY model request entities to avoid future migration churn, but no Worker/Admin UI is built.

---

## 11. SalaryRuleEngine — Interface Contract (Requirement `FR-MGR-SRE`)

The salary engine is the single authority for pay computation. v1 ships the **contract + a stub**; real Israeli labor-law rules plug in later without caller changes.

- **FR-MGR-SRE-1** A `SalaryRuleEngine` interface SHALL exist with at least a `compute(input): SalaryResult` operation.
- **FR-MGR-SRE-2** The engine SHALL support pluggable strategies selectable by mode: **`israeli-labor-law`** and **`fixed`**.
- **FR-MGR-SRE-3** Callers (API/services) SHALL depend only on the interface, never on a concrete implementation.
- **FR-MGR-SRE-4** The v1 stub SHALL be deterministic and clearly labeled as a stub in its result metadata.

### 11.1 Contract shape (illustrative; Matrix owns final typing)
```
interface SalaryComputationInput {
  workerId: string;
  siteId?: string;
  periodStart: ISODate;
  periodEnd: ISODate;
  mode: 'israeli-labor-law' | 'fixed';
  hoursByDay: Array<{ date: ISODate; hours: number; status: 'attendance'|'vacation'|'disease' }>;
  hourlyWage: number;           // resolved rate (by worker or by profession)
  fixedSalary?: number;         // used when mode === 'fixed'
  currency: string;
}

interface SalaryResult {
  gross: number;
  breakdown: Array<{ label: string; amount: number }>;  // e.g. base, overtime, deductions
  currency: string;
  mode: 'israeli-labor-law' | 'fixed';
  engineVersion: string;        // includes 'stub' marker in v1
  computedAt: ISODate;
}

interface SalaryRuleEngine {
  compute(input: SalaryComputationInput): SalaryResult;
}
```

### 11.2 v1 stub behavior
- **`fixed`**: returns `gross = fixedSalary` with a single breakdown line.
- **`israeli-labor-law`**: returns `gross = sum(hours) × hourlyWage` for `attendance` days, with breakdown lines for base pay; overtime, statutory premiums, and deductions are **placeholders (0)** and labeled deferred. This exercises the full path without asserting legal correctness.

---

## 12. Data Domains Overview
(Conceptual; Matrix owns schema and relationships.)

- **Users & Auth** — user, role, credentials (hashed), lockout state, session.
- **Sites** — construction site, status (active/archived), assignments.
- **Workers** — profile, docs (passport/ID, visa, height permit, ATTAT), level, profession, residence, start date, archive flag.
- **Compensation** — hourly wage by profession, per-worker wage, pay-rule mode, salary results.
- **Time** — attendance/vacation/disease entries; derived working-hours aggregates (day/week/month).
- **Financial ledgers** — loans, advance payments, P&L inputs (per site/date).
- **Requests** (modeled, not surfaced in v1) — vacation/loan/advance requests with status.
- **Documents/Media** — access-controlled file storage for worker docs and images.
- **Preferences** — per-user theme and language.

---

## 13. Success Metrics
- **SM-1** A Manager can create a worker end to end (Wizard → Details → Docs → Salary) in a single session.
- **SM-2** Dashboard rollups match underlying records for any site/date filter (reconciliation check).
- **SM-3** Salary computation for both modes returns a result via `SalaryRuleEngine` with correct stub math.
- **SM-4** All three languages render with correct direction (Hebrew RTL; English/Turkish LTR) with zero hard-coded strings.
- **SM-5** RBAC: a non-Manager token is rejected (403) on Manager endpoints in automated tests.
- **SM-6** P&L and working-hours PDFs generate in the active language/direction.

---

## 14. Assumptions
- **A-1** v1 authority is the Manager; other surfaces are documented for data-model completeness only.
- **A-2** Currency is single-currency per deployment (assumed ILS); multi-currency is not required in v1.
- **A-3** Revenue inputs for P&L are available from site/finance data; exact source refined by Matrix.
- **A-4** "Partner" is a reporting-weighted role; precise permission matrix finalized in Architecture.
- **A-5** Legal correctness of Israeli labor-law pay is explicitly deferred to a later rule-engine implementation.
- **A-6** Document storage provider and PDF library are Matrix decisions.

## 15. Open Risks
- **R-1** Israeli-labor-law rules are complex (overtime tiers, rest-day premiums, statutory deductions); the stub must not be mistaken for compliant pay. Mitigation: `engineVersion` stub marker + UI labeling (FR-MGR-SRE-4).
- **R-2** RTL/LTR mirroring across React + React Native can diverge; needs shared design tokens and testing.
- **R-3** Attendance exclusivity (FR-MGR-ATT-4) and how partial days are handled needs a clear rule before hours aggregation is trusted.
- **R-4** P&L revenue source is under-specified; risk of building cost-only P&L. Needs Matrix/Cortex clarification.
- **R-5** Modeling out-of-scope request entities now vs later — decide to avoid migration churn (FR-REQ-3).
- **R-6** Document PII handling and retention must meet privacy expectations for passports/visas (NFR-SEC-4/5).

---

*End of PRD. Handoff: Matrix (Architecture).*
