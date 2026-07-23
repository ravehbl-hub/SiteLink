# Runbook — merge `Customer` into `Company` (Option C)

Branch: `feat/merge-customer-into-company`. All code + migrations + backfill are authored
and gated. The **parent** runs every live-DB step below, in phases. A full JSON backup
exists at `backend/backups/full-backup-2026-07-21T15-21-14-252Z.json`.

## Ordered steps (parent runs these)

1. **Apply Phase A (additive, reversible)** — from `backend/`:
   ```
   npx prisma migrate deploy   # applies 20260721120000_merge_customer_phaseA_additive
   ```
   Adds nullable `companyId` to Billing/Usage/BusinessProfitLoss + the 4 new Company
   columns (contactEmail, contactPhone, registeredAt DEFAULT now(), leftAt). Drops nothing.
   Rollback SQL is in that file's trailing comment block (safe until Phase B runs).

2. **Regenerate the client** (already reflects final schema, but re-run to be safe):
   ```
   npx prisma generate
   ```

3. **Run the backfill** (idempotent; writes DB — parent only):
   ```
   npx tsx scripts/merge-customer-backfill.ts
   ```
   For each Customer: linked → copy contact/lifecycle onto its Company; orphan → create a
   new Company (deterministic id `mrgc_<customerId>`). Reparents every Billing/Usage/PnL
   row to `companyId`. Prints per-table counts and **asserts 0 NULL companyId** (throws
   otherwise).

4. **Verify** the backfill output shows `✓ 0 NULL companyId rows`. If not, STOP — do not
   apply Phase B. Investigate; Phase A rollback is still available.

5. **[HUMAN GO-AHEAD]** — Phase B is irreversible (drops the Customer table + customerId
   columns). Get explicit sign-off, and make sure the NEW backend build is ready to deploy.

6. **Apply Phase B (destructive, finalize)**:
   ```
   npx prisma migrate deploy   # applies 20260721121000_merge_customer_phaseB_finalize
   ```
   SET NOT NULL + FKs on companyId; drop customerId columns/indexes/FKs; drop
   Company.customerId (+ unique); `DROP TABLE "Customer"`. The SET NOT NULL statements
   fail-loud if any companyId is still null (second orphan guard).

7. **Regenerate + restart backend**:
   ```
   npx prisma generate
   # restart / redeploy the Fastify backend against the finalized schema
   ```

## Files
- Phase A: `backend/prisma/migrations/20260721120000_merge_customer_phaseA_additive/migration.sql`
- Phase B: `backend/prisma/migrations/20260721121000_merge_customer_phaseB_finalize/migration.sql`
- Backfill: `backend/scripts/merge-customer-backfill.ts`

## Orphan companies created by the backfill (7) — FOR AWARENESS
Only 1 of 8 Customers is linked to a Company (Acme Construction Ltd). The other 7 become
NEW Companies. Several are duplicate test junk:

| Customer id | Name | Billing/Usage rows | Note |
|---|---|---|---|
| seed-customer-02 | BuildRight Co | 2 billing, 2 usage, 1 pnl | real-ish seed |
| seed-customer-03 | Nordic Sites AB | none | archived seed (churned) |
| cmrte549i0019yxs5lj8bucvn | StageB Co RENAMED | none | **test junk (dup)** |
| cmrti65wk001930s5zhci9yny | StageB Co RENAMED | none | **test junk (dup)** |
| cmrq34szf0019his5vfysaoed | StageB Co RENAMED | none | **test junk (dup)** |
| cmrte59rn001ayxs55dq012p1 | StageB Billed 2031e34f | 1 billing | test junk (carries billing) |
| cmrq34yc4001ahis5cf6cko38 | StageB Billed 50703451 | 1 billing, 1 usage | test junk (carries billing) |

The two "StageB Billed …" orphans carry billing/usage rows, so they MUST get companies
(cannot be skipped). The three duplicate "StageB Co RENAMED" and "Nordic Sites AB" will
become empty companies. After the merge, the user may want to archive/delete the junk
companies via the System-Admin Companies screen (delete only if they have no billing rows).
