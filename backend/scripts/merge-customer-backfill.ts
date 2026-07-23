/**
 * Backfill for the Customer→Company merge (Option C). Runs BETWEEN Phase A (additive)
 * and Phase B (finalize). The parent runs this; it is idempotent.
 *
 * Logic (LOCKED rules):
 *   For each Customer:
 *     - If a Company links it (Company.customerId == customer.id) → target = that Company;
 *       COPY the customer's contactEmail/contactPhone/registeredAt/leftAt onto the Company
 *       ONLY where the Company's field is currently NULL (don't clobber existing values;
 *       registeredAt is copied only when the Company still holds its DEFAULT — see note).
 *     - Else (orphan) → CREATE a new Company { name, contactEmail, contactPhone,
 *       registeredAt, leftAt } from the customer; target = the new Company.
 *   Then set companyId = target.id on every Billing/Usage/BusinessProfitLoss row whose
 *   customerId == customer.id.
 *
 * Verification: prints rows updated per table + companies created, then asserts 0
 * Billing/Usage/PnL rows remain with a NULL companyId (aborts non-zero → Phase B's
 * SET NOT NULL would fail anyway; we fail earlier and louder).
 *
 * IMPLEMENTATION NOTE: this script MUST run against the Phase-A DB shape where BOTH the
 * old `customerId` columns AND the new nullable `companyId` columns exist, and the
 * `Customer` table still exists. The generated Prisma client reflects the FINAL schema
 * (no Customer model, no customerId), so we use raw SQL exclusively — it is agnostic to
 * the generated client and safe across the interim state.
 *
 * registeredAt copy: Phase A adds Company.registeredAt with DEFAULT now(). We cannot tell
 * a defaulted value from a deliberately-set one, so for a LINKED company we overwrite
 * registeredAt with the customer's value unconditionally (the customer is the source of
 * truth for that tenant's registration date). contactEmail/contactPhone/leftAt are copied
 * only where the company's value IS NULL (non-destructive).
 */
import 'dotenv/config';
import { prisma } from '../src/db/client.js';

interface CustomerRow {
  id: string;
  name: string;
  contactEmail: string | null;
  contactPhone: string | null;
  registeredAt: Date;
  leftAt: Date | null;
}

async function main(): Promise<void> {
  const customers = await prisma.$queryRaw<CustomerRow[]>`
    SELECT "id", "name", "contactEmail", "contactPhone", "registeredAt", "leftAt"
    FROM "Customer"
    ORDER BY "createdAt" ASC
  `;
  console.log(`Found ${customers.length} Customer rows to migrate.`);

  let companiesCreated = 0;
  let billingUpdated = 0;
  let usageUpdated = 0;
  let pnlUpdated = 0;

  for (const c of customers) {
    // 1. Resolve target company id.
    const linked = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Company" WHERE "customerId" = ${c.id} LIMIT 1
    `;

    let targetId: string;
    if (linked.length > 0 && linked[0]) {
      targetId = linked[0].id;
      // Copy contact/lifecycle onto the linked company (non-destructive where possible).
      await prisma.$executeRaw`
        UPDATE "Company" SET
          "contactEmail" = COALESCE("contactEmail", ${c.contactEmail}),
          "contactPhone" = COALESCE("contactPhone", ${c.contactPhone}),
          "leftAt"       = COALESCE("leftAt", ${c.leftAt}),
          "registeredAt" = ${c.registeredAt},
          "updatedAt"    = CURRENT_TIMESTAMP
        WHERE "id" = ${targetId}
      `;
      console.log(`  Customer ${c.id} (${c.name}) → linked Company ${targetId} (fields copied)`);
    } else {
      // Orphan → create a new Company from the customer. Deterministic id (prefixed with
      // the source customer id) makes the INSERT idempotent: a re-run hits ON CONFLICT DO
      // NOTHING and reuses the same target company, so billing rows never get split.
      const newId = `mrgc_${c.id}`;
      // Count only rows actually inserted, so a re-run (ON CONFLICT DO NOTHING → 0 rows)
      // does not overstate "Companies created".
      const inserted = await prisma.$executeRaw`
        INSERT INTO "Company"
          ("id", "name", "contactEmail", "contactPhone", "registeredAt", "leftAt",
           "isArchived", "createdAt", "updatedAt")
        VALUES
          (${newId}, ${c.name}, ${c.contactEmail}, ${c.contactPhone}, ${c.registeredAt},
           ${c.leftAt}, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT ("id") DO NOTHING
      `;
      targetId = newId;
      companiesCreated += inserted;
      const tag = inserted > 0 ? 'NEW' : 'reused';
      console.log(`  Customer ${c.id} (${c.name}) → ${tag} Company ${targetId} (orphan)`);
    }

    // 2. Reparent billing rows for this customer.
    billingUpdated += await prisma.$executeRaw`
      UPDATE "Billing" SET "companyId" = ${targetId}
      WHERE "customerId" = ${c.id} AND "companyId" IS NULL
    `;
    usageUpdated += await prisma.$executeRaw`
      UPDATE "Usage" SET "companyId" = ${targetId}
      WHERE "customerId" = ${c.id} AND "companyId" IS NULL
    `;
    pnlUpdated += await prisma.$executeRaw`
      UPDATE "BusinessProfitLoss" SET "companyId" = ${targetId}
      WHERE "customerId" = ${c.id} AND "companyId" IS NULL
    `;
  }

  // 3. Verification.
  const countNull = async (table: 'Billing' | 'Usage' | 'BusinessProfitLoss'): Promise<number> => {
    const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*)::bigint AS n FROM "${table}" WHERE "companyId" IS NULL`,
    );
    return Number(rows[0]?.n ?? 0n);
  };
  const billNull = await countNull('Billing');
  const usageNull = await countNull('Usage');
  const pnlNull = await countNull('BusinessProfitLoss');

  console.log('\n── Backfill summary ─────────────────────────────');
  console.log(`  Companies created (orphans): ${companiesCreated}`);
  console.log(`  Billing rows reparented:     ${billingUpdated}`);
  console.log(`  Usage rows reparented:       ${usageUpdated}`);
  console.log(`  BusinessProfitLoss reparented:${pnlUpdated}`);
  console.log(`  NULL companyId remaining → Billing:${billNull} Usage:${usageNull} PnL:${pnlNull}`);

  const remaining = billNull + usageNull + pnlNull;
  if (remaining !== 0) {
    throw new Error(
      `ABORT: ${remaining} Billing/Usage/PnL row(s) still have NULL companyId. ` +
        'Do NOT apply Phase B until this is 0.',
    );
  }
  console.log('  ✓ 0 NULL companyId rows — safe to apply Phase B.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('FAILED:', e?.message ?? e);
    await prisma.$disconnect();
    process.exit(1);
  });
