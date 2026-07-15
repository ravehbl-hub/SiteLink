/**
 * SiteLink — idempotent database seed.
 *
 * Safe to re-run: every write is an upsert keyed on a stable natural/unique key,
 * so `pnpm db:seed` twice yields the same rows (no duplicates).
 *
 * Enum values below are used verbatim from the generated Prisma enums, which are
 * kept byte-for-byte in sync with @sitelink/shared/src/enums.ts.
 *
 * NOTE ON USERS: the User table has NO password — credentials live in Supabase
 * Auth (Architecture §5). `authUserId` is the FK to the Supabase identity. Real
 * users are provisioned by the back end via the Supabase Admin API (§5.4);
 * the seed only writes placeholder `authUserId` values (`seed-<uuid>`) so the
 * app-side role/site-scope rows exist for local development.
 */
import { randomUUID } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';
// Prisma 7: import from the generated client (see generator `output` in schema.prisma).
import {
  AttendanceType,
  BillingStatus,
  PrismaClient,
  Profession,
  RateType,
  Role,
  SalaryCalcMode,
  SiteStatus,
  WorkerDocType,
  WorkerLevel,
} from '../src/generated/prisma/client.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set — cannot seed. See .env.example.');
}
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

/** Deterministic UTC midnight Date for a YYYY-MM-DD string (for @db.Date columns). */
function d(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

async function main() {
  console.log('▶ Seeding SiteLink database…');

  // ── Sites ──────────────────────────────────────────────────────────────────
  const siteA = await prisma.site.upsert({
    where: { id: 'seed-site-tower' },
    update: {},
    create: {
      id: 'seed-site-tower',
      name: 'Rothschild Tower',
      code: 'TLV-01',
      status: SiteStatus.ACTIVE,
      address: '1 Rothschild Blvd, Tel Aviv',
      startedAt: d('2026-01-15'),
    },
  });

  const siteB = await prisma.site.upsert({
    where: { id: 'seed-site-bridge' },
    update: {},
    create: {
      id: 'seed-site-bridge',
      name: 'Ayalon Overpass',
      code: 'TLV-02',
      status: SiteStatus.ACTIVE,
      address: 'Ayalon Hwy, Tel Aviv',
      startedAt: d('2026-03-01'),
    },
  });

  // ── Users (Supabase-backed; placeholder authUserId, NO password) ────────────
  // Real users come from Supabase Auth provisioning (Admin API, §5.4). These rows
  // only carry app-side authorization (role + primary site scope).
  await prisma.user.upsert({
    where: { email: 'manager@sitelink.example' },
    update: {},
    create: {
      authUserId: `seed-${randomUUID()}`, // placeholder Supabase identity id
      role: Role.MANAGER,
      fullName: 'Dana Manager',
      email: 'manager@sitelink.example',
      primarySiteId: siteA.id,
    },
  });

  await prisma.user.upsert({
    where: { email: 'admin@sitelink.example' },
    update: {},
    create: {
      authUserId: `seed-${randomUUID()}`, // placeholder Supabase identity id
      role: Role.ADMIN,
      fullName: 'Avi Admin',
      email: 'admin@sitelink.example',
    },
  });

  // WORKER-role login for the Worker app's self-scoped endpoints (Phase 05).
  // This user is LINKED to a Worker row below (Worker.userId) so requireWorkerId /
  // resolveWorkerId resolve — otherwise self-scoped routes 403 fail-closed.
  const workerUser = await prisma.user.upsert({
    where: { email: 'Worker@sitelink.example' },
    update: {},
    create: {
      authUserId: `seed-${randomUUID()}`, // placeholder Supabase identity id
      role: Role.WORKER,
      fullName: 'Worker',
      email: 'Worker@sitelink.example',
    },
  });

  // ── Profession wage rates (all 9 professions; mix of calc modes) ────────────
  // @@unique([profession, siteId]) — global rows use siteId = null.
  const wageRates: Array<{
    profession: Profession;
    wage: number;
    rateType: RateType;
    calcMode: SalaryCalcMode;
  }> = [
    { profession: Profession.IRONWORKER, wage: 62, rateType: RateType.HOURLY, calcMode: SalaryCalcMode.ISRAELI_LABOR_LAW },
    { profession: Profession.MOLDER, wage: 58, rateType: RateType.HOURLY, calcMode: SalaryCalcMode.ISRAELI_LABOR_LAW },
    { profession: Profession.CONCRETE_WORKER, wage: 55, rateType: RateType.HOURLY, calcMode: SalaryCalcMode.FIXED },
    { profession: Profession.GENERAL_LABORER, wage: 45, rateType: RateType.HOURLY, calcMode: SalaryCalcMode.FIXED },
    { profession: Profession.FOREMAN, wage: 14000, rateType: RateType.MONTHLY, calcMode: SalaryCalcMode.FIXED },
    { profession: Profession.MECHANIC, wage: 68, rateType: RateType.HOURLY, calcMode: SalaryCalcMode.ISRAELI_LABOR_LAW },
    { profession: Profession.ELECTRICIAN, wage: 72, rateType: RateType.HOURLY, calcMode: SalaryCalcMode.ISRAELI_LABOR_LAW },
    { profession: Profession.PLUMBER, wage: 70, rateType: RateType.HOURLY, calcMode: SalaryCalcMode.FIXED },
    { profession: Profession.OTHER, wage: 50, rateType: RateType.HOURLY, calcMode: SalaryCalcMode.FIXED },
  ];

  for (const wr of wageRates) {
    // siteId is null → cannot use the composite unique in `where` (null isn't a key),
    // so upsert by a stable synthetic id per global profession rate.
    const id = `seed-wage-${wr.profession}`;
    await prisma.professionWageRate.upsert({
      where: { id },
      update: {},
      create: {
        id,
        profession: wr.profession,
        wage: wr.wage,
        rateType: wr.rateType,
        calcMode: wr.calcMode,
        currency: 'ILS',
        siteId: null,
      },
    });
  }

  // ── Workers (+ salary data, a doc placeholder, and assignments) ─────────────
  const workerSeeds = [
    {
      id: 'seed-worker-01',
      firstName: 'Mehmet',
      lastName: 'Yilmaz',
      country: 'Turkey',
      profession: Profession.IRONWORKER,
      level: WorkerLevel.GOOD,
      hourlyWage: 62,
      rateType: RateType.HOURLY,
      site: siteA,
    },
    {
      id: 'seed-worker-02',
      firstName: 'Ion',
      lastName: 'Popescu',
      country: 'Romania',
      profession: Profession.CONCRETE_WORKER,
      level: WorkerLevel.MEDIUM,
      hourlyWage: 55,
      rateType: RateType.HOURLY,
      site: siteA,
    },
    {
      id: 'seed-worker-03',
      firstName: 'Ahmet',
      lastName: 'Demir',
      country: 'Turkey',
      profession: Profession.ELECTRICIAN,
      level: WorkerLevel.EXCELLENT,
      hourlyWage: 72,
      rateType: RateType.HOURLY,
      site: siteB,
    },
  ];

  for (const w of workerSeeds) {
    await prisma.worker.upsert({
      where: { id: w.id },
      update: {},
      create: {
        id: w.id,
        firstName: w.firstName,
        lastName: w.lastName,
        country: w.country,
        profession: w.profession,
        level: w.level,
        startDate: d('2026-02-01'),
        salaryData: {
          create: {
            hourlyWage: w.hourlyWage,
            rateType: w.rateType,
            currency: 'ILS',
          },
        },
      },
    });

    // Site assignment (Worker ⇄ Site m2m). @@unique([siteId, workerId]).
    await prisma.siteAssignment.upsert({
      where: { siteId_workerId: { siteId: w.site.id, workerId: w.id } },
      update: {},
      create: { siteId: w.site.id, workerId: w.id },
    });
  }

  // Link the WORKER login to a Worker row so the Worker app's self-scoped
  // endpoints resolve (Worker.userId is a UNIQUE FK — one worker per login).
  // seed-worker-01 has attendance rows, so /working-hours returns data.
  // Idempotent: re-running just re-sets the same userId on the same worker.
  await prisma.worker.update({
    where: { id: 'seed-worker-01' },
    data: { userId: workerUser.id },
  });

  // A WorkerDoc placeholder (FileRef metadata only — bytes live in Supabase
  // Storage, private `worker-docs` bucket, Architecture §7a).
  await prisma.workerDoc.upsert({
    where: { id: 'seed-doc-01' },
    update: {},
    create: {
      id: 'seed-doc-01',
      workerId: 'seed-worker-01',
      type: WorkerDocType.PASSPORT_ID,
      reference: 'placeholder',
      storageKey: 'worker-docs/seed-worker-01/PASSPORT_ID/placeholder.pdf',
      fileName: 'passport.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 0,
    },
  });

  // ── Attendance across a date range (one row per worker/day; @@unique) ───────
  const dates = ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05'];
  let attendanceCount = 0;
  for (const w of workerSeeds) {
    for (const [i, date] of dates.entries()) {
      // Vary types: mostly attendance, one vacation, one disease.
      const type =
        i === 3
          ? AttendanceType.VACATION
          : i === 4 && w.id === 'seed-worker-02'
            ? AttendanceType.DISEASE
            : AttendanceType.ATTENDANCE;
      await prisma.attendanceRecord.upsert({
        where: { workerId_date: { workerId: w.id, date: d(date) } },
        update: {},
        create: {
          workerId: w.id,
          siteId: w.site.id,
          date: d(date),
          type,
          hours: type === AttendanceType.ATTENDANCE ? 9 : null,
        },
      });
      attendanceCount++;
    }
  }

  // ── SaaS business layer (Customers / Billing / Usage / P&L) ─────────────────
  // A "Customer" here is one of SiteLink's own SaaS customers (a business that
  // operates SiteLink) — clearly-demo rows so the Back Office screens aren't
  // empty. Stable synthetic ids keep re-seeding idempotent. One customer is
  // archived (isArchived + leftAt) so the archived filter is testable.
  const customerSeeds = [
    {
      id: 'seed-customer-01',
      name: 'Acme Construction Ltd',
      contactEmail: 'billing@acme-construction.example',
      contactPhone: '+972-3-555-0101',
      registeredAt: d('2026-01-05'),
      archived: false,
    },
    {
      id: 'seed-customer-02',
      name: 'BuildRight Co',
      contactEmail: 'accounts@buildright.example',
      contactPhone: '+972-3-555-0202',
      registeredAt: d('2026-02-12'),
      archived: false,
    },
    {
      id: 'seed-customer-03',
      name: 'Nordic Sites AB',
      contactEmail: 'finance@nordicsites.example',
      contactPhone: '+46-8-555-0303',
      registeredAt: d('2025-11-20'),
      archived: true, // churned customer — exercises the archived filter
    },
  ];

  for (const c of customerSeeds) {
    await prisma.customer.upsert({
      where: { id: c.id },
      update: {},
      create: {
        id: c.id,
        name: c.name,
        contactEmail: c.contactEmail,
        contactPhone: c.contactPhone,
        registeredAt: c.registeredAt,
        isArchived: c.archived,
        // Archived customer also carries a leftAt + archivedAt timestamp.
        leftAt: c.archived ? d('2026-05-31') : null,
        archivedAt: c.archived ? d('2026-05-31') : null,
      },
    });
  }

  const activeCustomers = customerSeeds.filter((c) => !c.archived);

  // Billing: ~2 rows per active customer, varied status across the enum.
  const billingSeeds = [
    { id: 'seed-billing-01', customerId: 'seed-customer-01', status: BillingStatus.ACTIVE, plan: 'Pro', amount: 1490.0, periodStart: '2026-06-01', periodEnd: '2026-06-30' },
    { id: 'seed-billing-02', customerId: 'seed-customer-01', status: BillingStatus.ACTIVE, plan: 'Pro', amount: 1490.0, periodStart: '2026-07-01', periodEnd: '2026-07-31' },
    { id: 'seed-billing-03', customerId: 'seed-customer-02', status: BillingStatus.TRIALING, plan: 'Starter', amount: 0.0, periodStart: '2026-07-01', periodEnd: '2026-07-31' },
    { id: 'seed-billing-04', customerId: 'seed-customer-02', status: BillingStatus.PAST_DUE, plan: 'Starter', amount: 490.0, periodStart: '2026-06-01', periodEnd: '2026-06-30' },
  ];

  for (const b of billingSeeds) {
    await prisma.billing.upsert({
      where: { id: b.id },
      update: {},
      create: {
        id: b.id,
        customerId: b.customerId,
        status: b.status,
        plan: b.plan,
        amount: b.amount,
        currency: 'ILS',
        periodStart: d(b.periodStart),
        periodEnd: d(b.periodEnd),
      },
    });
  }

  // Usage: ~2-3 metric rows per active customer for the current period.
  const usageSeeds = [
    { id: 'seed-usage-01', customerId: 'seed-customer-01', metric: 'active_workers', value: 42 },
    { id: 'seed-usage-02', customerId: 'seed-customer-01', metric: 'api_calls', value: 128_540 },
    { id: 'seed-usage-03', customerId: 'seed-customer-01', metric: 'storage_gb', value: 18.5 },
    { id: 'seed-usage-04', customerId: 'seed-customer-02', metric: 'active_workers', value: 9 },
    { id: 'seed-usage-05', customerId: 'seed-customer-02', metric: 'api_calls', value: 12_300 },
  ];

  for (const u of usageSeeds) {
    await prisma.usage.upsert({
      where: { id: u.id },
      update: {},
      create: {
        id: u.id,
        customerId: u.customerId,
        metric: u.metric,
        value: u.value,
        periodStart: d('2026-07-01'),
        periodEnd: d('2026-07-31'),
      },
    });
  }

  // BusinessProfitLoss: one row per active customer for the current period.
  const pnlSeeds = [
    { id: 'seed-pnl-01', customerId: 'seed-customer-01', revenue: 1490.0, cost: 620.0, netProfit: 870.0 },
    { id: 'seed-pnl-02', customerId: 'seed-customer-02', revenue: 490.0, cost: 300.0, netProfit: 190.0 },
  ];

  for (const p of pnlSeeds) {
    await prisma.businessProfitLoss.upsert({
      where: { id: p.id },
      update: {},
      create: {
        id: p.id,
        customerId: p.customerId,
        periodStart: d('2026-07-01'),
        periodEnd: d('2026-07-31'),
        currency: 'ILS',
        revenue: p.revenue,
        cost: p.cost,
        netProfit: p.netProfit,
      },
    });
  }

  void activeCustomers; // documents intent; billing/usage keyed explicitly above

  // ── Report actual row counts ────────────────────────────────────────────────
  const [
    sites,
    users,
    rates,
    workers,
    salaries,
    docs,
    assignments,
    attendance,
    customers,
    customersArchived,
    billings,
    usages,
    pnl,
  ] = await Promise.all([
    prisma.site.count(),
    prisma.user.count(),
    prisma.professionWageRate.count(),
    prisma.worker.count(),
    prisma.workerSalaryData.count(),
    prisma.workerDoc.count(),
    prisma.siteAssignment.count(),
    prisma.attendanceRecord.count(),
    prisma.customer.count(),
    prisma.customer.count({ where: { isArchived: true } }),
    prisma.billing.count(),
    prisma.usage.count(),
    prisma.businessProfitLoss.count(),
  ]);

  console.log('✔ Seed complete. Row counts:');
  console.table({
    sites,
    users,
    professionWageRates: rates,
    workers,
    workerSalaryData: salaries,
    workerDocs: docs,
    siteAssignments: assignments,
    attendanceRecords: attendance,
    attendanceWritten: attendanceCount,
    customers,
    customersArchived,
    billings,
    usages,
    businessProfitLoss: pnl,
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error('✖ Seed failed:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
