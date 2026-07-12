# SiteLink — Construction Site Management

Multi-role construction-site workforce & finance management system.

Built by the SiteLink agent fleet under Cortex orchestration, from the topology at
`../Topology/SiteLink - Topology-01-2026-07-06.pdf`.

## Surfaces (by role)

| Role | Platform | Directory | v1 scope |
|------|----------|-----------|----------|
| Manager | Web (tab menu) + App (hamburger) | `Frontend/manager/{web,app}` | **In scope** |
| Foreman | App (hamburger) | `Frontend/Foreman/app` | Future |
| Worker | App (hamburger) | `Frontend/Worker/app` | Future |
| Back Office | Web (vertical menu, LR/RL by language) | `Frontend/backoffice/web` | Future |

All surfaces share one Node/TypeScript back end (`backend/`), one PostgreSQL database,
and a common types package (`packages/shared`).

## Confirmed build defaults (v1)

- **Stack:** TypeScript. React (web) + React Native (apps).
- **Database:** PostgreSQL.
- **First slice:** Manager (web + app) + back end.
- **Salary rules:** swappable `SalaryRuleEngine` interface (Israeli-labor-law stub + flat).
- **Hosting:** Vercel (front ends) + Railway (back end + Postgres).

## Cross-cutting

- Roles: Admin / Manager / Partner / Foreman / Worker.
- i18n: Hebrew (RTL), English, Turkish (LTR).
- Dark / light theming on every surface.
- Worker → admin request-approval workflow (vacation / loan / advance).
- PDF report exports.

## Documentation

- `docs/PRD.md` — Product requirements (Manifest)
- `docs/ARCHITECTURE.md` — Technical architecture (Matrix)
- `docs/SCHEMA.md` / `packages/shared` — Shared data schema & types (Lattice/Savant)

## Status

Phase 01 (PRD + architecture + shared schema) in progress. Build begins after PRD sign-off.
