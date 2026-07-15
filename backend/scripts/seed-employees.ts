/**
 * SiteLink — DEMO employee seeder (Savant/DB, user-approved demo data).
 *
 * Creates 20 ACTIVE workers, each a COMPLETE, loginable WORKER employee by
 * REUSING the production worker-create path: WorkersService.create() →
 * provisionAndLinkLogin(). That means each seeded worker gets, exactly like a
 * Manager creating them in the app:
 *   Supabase Auth identity  →  app User(role=WORKER, authUserId)  →  Worker.userId link
 * plus site assignments (SiteAssignment) via the same create input. No bare
 * Worker rows, no half-linked logins — the service's compensating rollback owns
 * per-worker failure.
 *
 * IDEMPOTENT: this script is a SEPARATE, opt-in script (NOT wired into db:seed).
 * Before creating each worker it checks User.email — if a login already exists we
 * SKIP that worker. Re-running therefore resumes only the missing ones (never 40,
 * never a duplicate-email crash). Site upserts + attendance upserts are keyed on
 * stable/unique keys too.
 *
 * RATE LIMITS: creating 20 Supabase Auth identities can hit Auth rate limits, so
 * creates are PACED with a small delay and partial failure is tolerated — we log
 * how many succeeded and re-running picks up the rest.
 *
 * DEMO PASSWORD: a single shared, NON-SECRET dev password is used so the workers
 * are immediately loginable for the demo. It is read from SEED_DEMO_PASSWORD if
 * set; otherwise it falls back to the documented demo constant below. This is
 * demo-only — do NOT reuse for anything real.
 *
 *   Run (sandbox-disabled, from backend/):  npx tsx scripts/seed-employees.ts
 */
import 'dotenv/config';

import { loadConfig } from '../src/config.js';
import { prisma } from '../src/db/client.js';
import { SupabaseService } from '../src/lib/supabase.js';
import { WorkersService } from '../src/modules/workers/service.js';
import {
  AttendanceType,
  Profession,
  SiteStatus,
  WorkerLevel,
} from '../src/generated/prisma/client.js';

// DEMO-ONLY shared initial password (non-secret). Prefer the env override.
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'SiteLinkDemo!2026';

const EMAIL_DOMAIN = 'sitelink-demo.example';

/** Small pacing delay between Supabase Auth creates to respect Auth rate limits. */
const AUTH_PACE_MS = Number(process.env.SEED_AUTH_PACE_MS ?? 1500);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Deterministic UTC-midnight Date for a YYYY-MM-DD string (@db.Date columns). */
function d(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/**
 * Demo sites to distribute workers across. Stable ids → idempotent upsert. The
 * two pre-existing seed sites (tower/bridge) are included so we build on top of
 * them rather than duplicating. Target ~12 sites total.
 */
const SITE_SEEDS: Array<{ id: string; name: string; code: string; address: string }> = [
  { id: 'seed-site-tower', name: 'Rothschild Tower', code: 'TLV-01', address: '1 Rothschild Blvd, Tel Aviv' },
  { id: 'seed-site-bridge', name: 'Ayalon Overpass', code: 'TLV-02', address: 'Ayalon Hwy, Tel Aviv' },
  { id: 'seed-site-marina', name: 'Herzliya Marina Residences', code: 'HRZ-01', address: 'Marina, Herzliya' },
  { id: 'seed-site-metro', name: 'Metro Red Line Station', code: 'TLV-03', address: 'Allenby, Tel Aviv' },
  { id: 'seed-site-mall', name: 'Grand Mall Extension', code: 'RMG-01', address: 'Ramat Gan' },
  { id: 'seed-site-hospital', name: 'Carmel Hospital Wing', code: 'HFA-01', address: 'Haifa' },
  { id: 'seed-site-campus', name: 'Tech Campus Block B', code: 'BSH-01', address: "Be'er Sheva" },
  { id: 'seed-site-port', name: 'Ashdod Port Terminal', code: 'ASH-01', address: 'Ashdod' },
  { id: 'seed-site-stadium', name: 'North Stadium Renovation', code: 'NTY-01', address: 'Netanya' },
  { id: 'seed-site-tunnel', name: 'Coastal Tunnel Segment', code: 'HFA-02', address: 'Haifa' },
  { id: 'seed-site-solar', name: 'Negev Solar Field', code: 'NGV-01', address: 'Negev' },
  { id: 'seed-site-bridge2', name: 'Jordan River Crossing', code: 'JRD-01', address: 'Jordan Valley' },
];

/** 20 realistic demo workers. `sites` are indexes into SITE_SEEDS (distribution). */
const WORKER_SEEDS: Array<{
  n: number;
  firstName: string;
  lastName: string;
  profession: Profession;
  level: WorkerLevel;
  phone: string;
  country: string;
  sites: number[];
}> = [
  { n: 1, firstName: 'Mehmet', lastName: 'Yilmaz', profession: Profession.IRONWORKER, level: WorkerLevel.GOOD, phone: '+90-532-100-0001', country: 'Turkey', sites: [0] },
  { n: 2, firstName: 'Ion', lastName: 'Popescu', profession: Profession.CONCRETE_WORKER, level: WorkerLevel.MEDIUM, phone: '+40-72-100-0002', country: 'Romania', sites: [0] },
  { n: 3, firstName: 'Ahmet', lastName: 'Demir', profession: Profession.ELECTRICIAN, level: WorkerLevel.EXCELLENT, phone: '+90-532-100-0003', country: 'Turkey', sites: [0, 3] },
  { n: 4, firstName: 'Andrei', lastName: 'Ionescu', profession: Profession.MOLDER, level: WorkerLevel.GOOD, phone: '+40-72-100-0004', country: 'Romania', sites: [0] },
  { n: 5, firstName: 'Yosef', lastName: 'Cohen', profession: Profession.FOREMAN, level: WorkerLevel.EXCELLENT, phone: '+972-52-100-0005', country: 'Israel', sites: [1] },
  { n: 6, firstName: 'Georgi', lastName: 'Ivanov', profession: Profession.GENERAL_LABORER, level: WorkerLevel.MEDIUM, phone: '+359-88-100-0006', country: 'Bulgaria', sites: [1] },
  { n: 7, firstName: 'Mustafa', lastName: 'Kaya', profession: Profession.PLUMBER, level: WorkerLevel.GOOD, phone: '+90-532-100-0007', country: 'Turkey', sites: [1, 4] },
  { n: 8, firstName: 'Radu', lastName: 'Munteanu', profession: Profession.MECHANIC, level: WorkerLevel.GOOD, phone: '+40-72-100-0008', country: 'Romania', sites: [2] },
  { n: 9, firstName: 'Emin', lastName: 'Aydin', profession: Profession.IRONWORKER, level: WorkerLevel.MEDIUM, phone: '+90-532-100-0009', country: 'Turkey', sites: [2] },
  { n: 10, firstName: 'David', lastName: 'Levi', profession: Profession.ELECTRICIAN, level: WorkerLevel.GOOD, phone: '+972-52-100-0010', country: 'Israel', sites: [2, 5] },
  { n: 11, firstName: 'Nikola', lastName: 'Petrov', profession: Profession.CONCRETE_WORKER, level: WorkerLevel.WEAK, phone: '+359-88-100-0011', country: 'Bulgaria', sites: [3] },
  { n: 12, firstName: 'Hasan', lastName: 'Ozturk', profession: Profession.MOLDER, level: WorkerLevel.MEDIUM, phone: '+90-532-100-0012', country: 'Turkey', sites: [3] },
  { n: 13, firstName: 'Cristian', lastName: 'Stan', profession: Profession.GENERAL_LABORER, level: WorkerLevel.MEDIUM, phone: '+40-72-100-0013', country: 'Romania', sites: [4] },
  { n: 14, firstName: 'Moshe', lastName: 'Friedman', profession: Profession.FOREMAN, level: WorkerLevel.EXCELLENT, phone: '+972-52-100-0014', country: 'Israel', sites: [5] },
  { n: 15, firstName: 'Ali', lastName: 'Sahin', profession: Profession.PLUMBER, level: WorkerLevel.GOOD, phone: '+90-532-100-0015', country: 'Turkey', sites: [6] },
  { n: 16, firstName: 'Dimitar', lastName: 'Georgiev', profession: Profession.MECHANIC, level: WorkerLevel.MEDIUM, phone: '+359-88-100-0016', country: 'Bulgaria', sites: [6] },
  { n: 17, firstName: 'Florin', lastName: 'Dumitru', profession: Profession.IRONWORKER, level: WorkerLevel.GOOD, phone: '+40-72-100-0017', country: 'Romania', sites: [7] },
  { n: 18, firstName: 'Kemal', lastName: 'Arslan', profession: Profession.OTHER, level: WorkerLevel.MEDIUM, phone: '+90-532-100-0018', country: 'Turkey', sites: [8] },
  { n: 19, firstName: 'Itai', lastName: 'Mizrahi', profession: Profession.ELECTRICIAN, level: WorkerLevel.GOOD, phone: '+972-52-100-0019', country: 'Israel', sites: [9] },
  { n: 20, firstName: 'Petar', lastName: 'Dimitrov', profession: Profession.CONCRETE_WORKER, level: WorkerLevel.MEDIUM, phone: '+359-88-100-0020', country: 'Bulgaria', sites: [10, 11] },
];

function emailFor(n: number): string {
  return `worker${String(n).padStart(2, '0')}@${EMAIL_DOMAIN}`;
}

async function ensureSites(): Promise<void> {
  for (const s of SITE_SEEDS) {
    await prisma.site.upsert({
      where: { id: s.id },
      update: {},
      create: {
        id: s.id,
        name: s.name,
        code: s.code,
        status: SiteStatus.ACTIVE,
        address: s.address,
        startedAt: d('2026-01-15'),
      },
    });
  }
}

async function main() {
  const config = loadConfig();
  const supabase = new SupabaseService(config);
  const workers = new WorkersService(supabase);

  console.log('▶ Ensuring demo sites exist…');
  await ensureSites();

  let created = 0;
  let skipped = 0;
  let failed = 0;

  console.log('▶ Seeding 20 demo workers via the production create path…');
  for (const w of WORKER_SEEDS) {
    const email = emailFor(w.n);

    // IDEMPOTENCY: skip if a login for this email already exists.
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      skipped++;
      console.log(`  · ${email} already exists → skip`);
      continue;
    }

    const siteIds = w.sites.map((i) => SITE_SEEDS[i].id);
    try {
      // Reuses provisionAndLinkLogin → real Supabase identity + User(WORKER) + link.
      const result = await workers.create({
        firstName: w.firstName,
        lastName: w.lastName,
        profession: w.profession,
        level: w.level,
        country: w.country,
        phone: w.phone,
        email,
        password: DEMO_PASSWORD, // Manager-set initial password → immediately loginable
        siteIds,
        startDate: d('2026-02-01').toISOString(),
      });
      created++;
      console.log(`  ✔ ${email} (${w.profession}) → sites ${siteIds.join(', ')} [worker ${result.id}]`);
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✖ ${email} FAILED: ${msg} (re-run to resume; no orphan left — service rolled back)`);
    }

    // Pace Auth creates to respect Supabase Auth rate limits.
    await sleep(AUTH_PACE_MS);
  }

  // ── Attendance for a subset (current period) so dashboards aren't empty ──────
  // Mix of ATTENDANCE / VACATION / DISEASE. Keyed on @@unique([workerId, date]).
  console.log('▶ Adding attendance for a subset (current period)…');
  const dates = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10'];
  let attendanceWritten = 0;
  const subset = WORKER_SEEDS.slice(0, 8); // first 8 workers get attendance
  for (const w of subset) {
    const email = emailFor(w.n);
    const worker = await prisma.worker.findFirst({
      where: { email },
      include: { assignments: true },
    });
    if (!worker) continue; // creation may have been skipped/failed
    const siteId = worker.assignments[0]?.siteId ?? null;
    for (const [i, date] of dates.entries()) {
      const type =
        i === 3
          ? AttendanceType.VACATION
          : i === 4 && w.n % 3 === 0
            ? AttendanceType.DISEASE
            : AttendanceType.ATTENDANCE;
      await prisma.attendanceRecord.upsert({
        where: { workerId_date: { workerId: worker.id, date: d(date) } },
        update: {},
        create: {
          workerId: worker.id,
          siteId,
          date: d(date),
          type,
          hours: type === AttendanceType.ATTENDANCE ? 9 : null,
        },
      });
      attendanceWritten++;
    }
  }

  // ── Verification counts (live DB) ───────────────────────────────────────────
  const [totalActive, linked, workerUsers, workerUsersWithAuth] = await Promise.all([
    prisma.worker.count({ where: { isArchived: false } }),
    prisma.worker.count({ where: { isArchived: false, userId: { not: null } } }),
    prisma.user.count({ where: { role: 'WORKER' } }),
    prisma.user.count({ where: { role: 'WORKER', authUserId: { not: { startsWith: 'seed-' } } } }),
  ]);

  const distribution = await prisma.siteAssignment.groupBy({
    by: ['siteId'],
    where: { unassignedAt: null },
    _count: { _all: true },
  });

  console.log('\n✔ Demo employee seed complete.');
  console.table({ created, skipped, failed, attendanceWritten });
  console.log('Live DB counts:');
  console.table({
    activeWorkers: totalActive,
    activeWorkersLinkedToLogin: linked,
    workerRoleUsers: workerUsers,
    workerRoleUsersWithRealAuthId: workerUsersWithAuth,
  });
  console.log('Active site-assignment distribution (siteId → count):');
  for (const row of distribution) {
    console.log(`  ${row.siteId}: ${row._count._all}`);
  }
  console.log(`\nDEMO login password (demo-only, non-secret): ${DEMO_PASSWORD}`);
  console.log(`DEMO login emails: worker01@${EMAIL_DOMAIN} … worker20@${EMAIL_DOMAIN}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('✖ seed-employees failed:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
