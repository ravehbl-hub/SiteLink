/**
 * SiteLink — DEMO employee seeder PLUS (Savant/DB, user-approved demo data).
 *
 * ADDITIVE sibling to seed-employees.ts. Adds 80 MORE demo workers (n=21..100)
 * WITHOUT touching the original 20 (worker01..20) or any existing row. It reuses
 * the SAME proven building blocks as seed-employees.ts:
 *   - the production create path WorkersService.create() → provisionAndLinkLogin()
 *     (real Supabase identity → app User(role WORKER) → Worker.userId link),
 *   - the SITE_SEEDS demo sites (upserted by stable id; NOT duplicated here — it
 *     just upserts the same set so the sites exist before assigning),
 *   - the AttendanceRecord.upsert pattern keyed on @@unique([workerId,date]),
 *   - paced Auth creates + idempotent skip-on-existing-email.
 *
 * WHAT'S NEW vs the original:
 *   1. 80 NEW workers, emails worker21@…  … worker100@sitelink-demo.example.
 *   2. Work hours (attendance) for EACH of the 80 across recent working days of the
 *      CURRENT month (weekends skipped; never future-dated).
 *   3. WorkerRequest rows for a SUBSET (~25) of the 80 — mostly PENDING (so the
 *      manager Requests inbox has content to act on) with a FEW already-APPROVED
 *      that ALSO get their consistent tagged side-effects (Loan/AdvancePayment/
 *      AttendanceRecord with requestId = the request id), exactly as the app's
 *      approval logic (requests/service.applyApprovalEffect) would materialize.
 *
 * SAFETY / IDEMPOTENCY:
 *   - Keyed on the DISTINCT email range worker21..100 → never collides with the
 *     existing 20 and never duplicates on re-run (skip-on-existing User.email).
 *   - Attendance uses upsert (create-if-missing) → stable on re-run.
 *   - Requests are guarded by a stable notes MARKER ("[seed-plus]") so re-running
 *     never creates a second batch of requests for the same worker.
 *   - Everything is DETERMINISTIC per-worker (seeded by n) → stable re-runs.
 *   - NEVER modifies/deletes existing workers/attendance/requests.
 *
 * REVERSIBLE: every row this script creates is identifiable by the worker21..100
 * email range (workers/users) and, for financial/attendance/request rows, by that
 * worker set + the "[seed-plus]" notes marker on requests. See the header of the
 * task report for the exact delete-by-email-range recipe.
 *
 *   Run (sandbox-disabled, from backend/):  npx tsx scripts/seed-employees-plus.ts
 */
import 'dotenv/config';

import { loadConfig } from '../src/config.js';
import { prisma } from '../src/db/client.js';
import { SupabaseService } from '../src/lib/supabase.js';
import { WorkersService } from '../src/modules/workers/service.js';
import {
  AttendanceType,
  Profession,
  RequestStatus,
  RequestType,
  SiteStatus,
  WorkerLevel,
} from '../src/generated/prisma/client.js';

// DEMO-ONLY shared initial password (non-secret). Prefer the env override.
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'SiteLinkDemo!2026';

const EMAIL_DOMAIN = 'sitelink-demo.example';

/** Distinct range for THIS additive batch — never collides with worker01..20. */
const N_START = 21;
const N_END = 100; // inclusive → 80 workers

/** Stable marker so re-runs never duplicate requests for the same worker. */
const REQUEST_MARKER = '[seed-plus]';

/** Small pacing delay between Supabase Auth creates to respect Auth rate limits. */
const AUTH_PACE_MS = Number(process.env.SEED_AUTH_PACE_MS ?? 1500);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Deterministic UTC-midnight Date for a YYYY-MM-DD string (@db.Date columns). */
function d(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/**
 * Demo sites to distribute workers across — SAME stable ids as seed-employees.ts so
 * upsert is a no-op when the original seeder already ran (we build on top, never
 * duplicate). Kept in-sync intentionally (copy of SITE_SEEDS).
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

// ── Deterministic name pools (varied across countries) ───────────────────────
const NAME_POOLS: Array<{
  country: string;
  phonePrefix: string;
  first: string[];
  last: string[];
}> = [
  {
    country: 'Turkey',
    phonePrefix: '+90-532-200',
    first: ['Mehmet', 'Ahmet', 'Mustafa', 'Ali', 'Hasan', 'Emre', 'Yusuf', 'Ibrahim', 'Kemal', 'Osman', 'Burak', 'Serkan'],
    last: ['Yilmaz', 'Demir', 'Kaya', 'Sahin', 'Ozturk', 'Arslan', 'Aydin', 'Celik', 'Yildiz', 'Dogan', 'Koc', 'Kurt'],
  },
  {
    country: 'Romania',
    phonePrefix: '+40-72-200',
    first: ['Ion', 'Andrei', 'Radu', 'Cristian', 'Florin', 'Mihai', 'Gabriel', 'Vasile', 'Bogdan', 'Marius', 'Nicolae', 'Adrian'],
    last: ['Popescu', 'Ionescu', 'Munteanu', 'Stan', 'Dumitru', 'Radu', 'Georgescu', 'Marin', 'Constantin', 'Barbu', 'Nistor', 'Toma'],
  },
  {
    country: 'Bulgaria',
    phonePrefix: '+359-88-200',
    first: ['Georgi', 'Nikola', 'Dimitar', 'Petar', 'Ivan', 'Stefan', 'Todor', 'Kaloyan', 'Boris', 'Vasil', 'Angel', 'Hristo'],
    last: ['Ivanov', 'Petrov', 'Georgiev', 'Dimitrov', 'Stoyanov', 'Kolev', 'Angelov', 'Todorov', 'Nikolov', 'Marinov', 'Iliev', 'Vasilev'],
  },
  {
    country: 'Israel',
    phonePrefix: '+972-52-200',
    first: ['Yosef', 'David', 'Moshe', 'Itai', 'Avi', 'Eitan', 'Noam', 'Amir', 'Yonatan', 'Dov', 'Shai', 'Oren'],
    last: ['Cohen', 'Levi', 'Mizrahi', 'Friedman', 'Peretz', 'Biton', 'Avraham', 'Dahan', 'Azoulay', 'Gabbay', 'Shapira', 'Ben-David'],
  },
];

const PROFESSIONS: Profession[] = [
  Profession.IRONWORKER,
  Profession.MOLDER,
  Profession.CONCRETE_WORKER,
  Profession.GENERAL_LABORER,
  Profession.FOREMAN,
  Profession.MECHANIC,
  Profession.ELECTRICIAN,
  Profession.PLUMBER,
  Profession.OTHER,
];

const LEVELS: WorkerLevel[] = [
  WorkerLevel.WEAK,
  WorkerLevel.MEDIUM,
  WorkerLevel.GOOD,
  WorkerLevel.EXCELLENT,
];

function emailFor(n: number): string {
  return `worker${String(n).padStart(2, '0')}@${EMAIL_DOMAIN}`;
}

/**
 * Fully deterministic worker spec derived from n (so re-runs are identical). Rotates
 * through country/name pools, professions, levels, and SITE_SEEDS indexes. Every 5th
 * worker is multi-site.
 */
function specFor(n: number): {
  n: number;
  firstName: string;
  lastName: string;
  profession: Profession;
  level: WorkerLevel;
  phone: string;
  country: string;
  sites: number[];
} {
  const pool = NAME_POOLS[n % NAME_POOLS.length];
  const firstName = pool.first[(n * 7) % pool.first.length];
  const lastName = pool.last[(n * 3) % pool.last.length];
  const profession = PROFESSIONS[n % PROFESSIONS.length];
  const level = LEVELS[(n * 5) % LEVELS.length];
  const phone = `${pool.phonePrefix}-${String(n).padStart(4, '0')}`;
  const primarySite = n % SITE_SEEDS.length;
  const sites =
    n % 5 === 0
      ? [primarySite, (primarySite + 1) % SITE_SEEDS.length]
      : [primarySite];
  return { n, firstName, lastName, profession, level, phone, country: pool.country, sites };
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

/** ISO YYYY-MM-DD for a Date (UTC). */
function iso(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}

/**
 * The most-recent working days (Mon–Fri) of the CURRENT month, up to `count`, none
 * in the future. Returns ascending ISO strings. `now` is passed in for determinism
 * within a single run.
 */
function recentWorkingDays(now: Date, count: number): string[] {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const today = now.getUTCDate();
  const days: string[] = [];
  for (let day = today; day >= 1 && days.length < count; day--) {
    const dt = new Date(Date.UTC(year, month, day));
    const dow = dt.getUTCDay(); // 0 Sun … 6 Sat
    if (dow === 0 || dow === 6) continue; // skip weekends
    days.push(iso(dt));
  }
  return days.reverse(); // ascending
}

async function main() {
  const config = loadConfig();
  const supabase = new SupabaseService(config);
  const workers = new WorkersService(supabase);

  // A manager/admin id to attribute APPROVED requests to (resolvedById). Required for
  // the FEW already-approved demo requests so they're consistent with the app model.
  const resolver = await prisma.user.findFirst({
    where: { role: { in: ['ADMIN', 'MANAGER'] } },
    select: { id: true, email: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log('▶ Ensuring demo sites exist (upsert; no-op if seed-employees ran)…');
  await ensureSites();

  const now = new Date();
  const specs = Array.from({ length: N_END - N_START + 1 }, (_, i) => specFor(N_START + i));

  // ── 1) 80 NEW workers via the production create path ────────────────────────
  let created = 0;
  let skipped = 0;
  let failed = 0;

  console.log(`▶ Seeding ${specs.length} NEW demo workers (worker${N_START}..${N_END}) via WorkersService.create…`);
  for (const w of specs) {
    const email = emailFor(w.n);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      skipped++;
      console.log(`  · ${email} already exists → skip`);
      continue;
    }

    const siteIds = w.sites.map((i) => SITE_SEEDS[i].id);
    try {
      const result = await workers.create({
        firstName: w.firstName,
        lastName: w.lastName,
        profession: w.profession,
        level: w.level,
        country: w.country,
        phone: w.phone,
        email,
        password: DEMO_PASSWORD,
        siteIds,
        startDate: d('2026-03-01').toISOString(),
      });
      created++;
      console.log(`  ✔ ${email} (${w.profession}/${w.level}, ${w.country}) → sites ${siteIds.join(', ')} [worker ${result.id}]`);
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✖ ${email} FAILED: ${msg} (re-run to resume; service rolled back — no orphan)`);
    }

    await sleep(AUTH_PACE_MS);
  }

  // ── 2) Work hours (attendance) for EACH of the 80 ───────────────────────────
  // Deterministic per-worker window over recent working days of the current month.
  // Mostly ATTENDANCE (8–10h); a couple VACATION/DISEASE mixed in. Upsert-keyed on
  // @@unique([workerId,date]) → stable on re-run, never future-dated.
  console.log('▶ Seeding work hours (attendance) for the new workers…');
  let attendanceWritten = 0;
  for (const w of specs) {
    const email = emailFor(w.n);
    const worker = await prisma.worker.findFirst({
      where: { email },
      include: { assignments: true },
    });
    if (!worker) continue; // create was skipped/failed
    const siteId = worker.assignments[0]?.siteId ?? null;

    // 10–18 working days, deterministic per worker.
    const windowLen = 10 + (w.n % 9); // 10..18
    const days = recentWorkingDays(now, windowLen);

    for (const [i, date] of days.entries()) {
      // Deterministic type mix: one VACATION and (for some workers) one DISEASE day.
      let type: AttendanceType = AttendanceType.ATTENDANCE;
      if (i === (w.n % 4) + 1) type = AttendanceType.VACATION;
      else if (w.n % 3 === 0 && i === (w.n % 5) + 2) type = AttendanceType.DISEASE;

      const hours = type === AttendanceType.ATTENDANCE ? 8 + ((w.n + i) % 3) : null; // 8..10
      await prisma.attendanceRecord.upsert({
        where: { workerId_date: { workerId: worker.id, date: d(date) } },
        update: {}, // never mutate an existing row
        create: {
          workerId: worker.id,
          siteId,
          date: d(date),
          type,
          hours,
        },
      });
      attendanceWritten++;
    }
  }

  // ── 3) Requests for a SUBSET (~25) of the 80 ────────────────────────────────
  // DECISION: mostly PENDING (manager inbox has content to act on). A FEW APPROVED
  // — and for those we ALSO create the matching TAGGED side-effect (requestId set)
  // exactly like requests/service.applyApprovalEffect would, so the data is
  // consistent with the approval/redecide logic. A couple REJECTED (no side-effect).
  // Guarded by the REQUEST_MARKER in notes so re-runs never duplicate.
  console.log('▶ Seeding worker requests (mostly PENDING + a few APPROVED w/ side-effects)…');
  const reqStats = {
    pendingVacation: 0,
    pendingLoan: 0,
    pendingAdvance: 0,
    approvedLoan: 0,
    approvedAdvance: 0,
    approvedVacation: 0,
    rejected: 0,
    skippedExisting: 0,
  };

  // Every 3rd worker in the batch gets a request → ~26 of 80.
  const requestSpecs = specs.filter((w) => w.n % 3 === 0);

  for (const w of requestSpecs) {
    const email = emailFor(w.n);
    const worker = await prisma.worker.findFirst({ where: { email } });
    if (!worker) continue;

    // Idempotency: skip if this worker already has a [seed-plus]-marked request.
    const already = await prisma.workerRequest.findFirst({
      where: { workerId: worker.id, notes: { contains: REQUEST_MARKER } },
      select: { id: true },
    });
    if (already) {
      reqStats.skippedExisting++;
      continue;
    }

    // Deterministic type/status selection.
    const typePick = w.n % 3 === 0 ? (w.n % 9 === 0 ? 'ADVANCE' : w.n % 6 === 0 ? 'LOAN' : 'VACATION') : 'VACATION';
    // Status: most PENDING. n divisible by 12 → APPROVED, n%15===0 (and not %12) → REJECTED.
    let status: RequestStatus = RequestStatus.PENDING;
    if (w.n % 12 === 0) status = RequestStatus.APPROVED;
    else if (w.n % 15 === 0) status = RequestStatus.REJECTED;

    const resolved =
      status !== RequestStatus.PENDING
        ? {
            status,
            resolvedById: resolver?.id ?? null,
            resolvedAt: now,
            resolutionNotes: `${REQUEST_MARKER} demo ${status.toLowerCase()} by seeder`,
          }
        : { status: RequestStatus.PENDING };

    if (typePick === 'VACATION') {
      // Vacation window in the NEXT week (future dates are fine for a vacation REQUEST;
      // only ATTENDANCE rows must not be future-dated — and for APPROVED vacation the
      // side-effect attendance days below can be future vacation days, which is valid).
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 3));
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 4));
      const req = await prisma.workerRequest.create({
        data: {
          workerId: worker.id,
          type: RequestType.VACATION,
          startDate: d(iso(start)),
          endDate: d(iso(end)),
          notes: `${REQUEST_MARKER} vacation request`,
          ...resolved,
        },
      });
      if (status === RequestStatus.APPROVED) {
        // Consistent tagged side-effect: VACATION AttendanceRecord(s) with requestId,
        // mirroring applyApprovalEffect (respect the one-record-per-day unique guard).
        for (
          let cur = new Date(start);
          cur <= end;
          cur = new Date(cur.getTime() + 86_400_000)
        ) {
          const day = d(iso(cur));
          const exists = await prisma.attendanceRecord.findUnique({
            where: { workerId_date: { workerId: worker.id, date: day } },
            select: { id: true },
          });
          if (exists) continue;
          await prisma.attendanceRecord.create({
            data: {
              workerId: worker.id,
              date: day,
              type: AttendanceType.VACATION,
              notes: `${REQUEST_MARKER} approved vacation`,
              requestId: req.id,
            },
          });
        }
        reqStats.approvedVacation++;
      } else if (status === RequestStatus.REJECTED) reqStats.rejected++;
      else reqStats.pendingVacation++;
    } else {
      // LOAN or ADVANCE — amount + currency ILS.
      const type = typePick === 'LOAN' ? RequestType.LOAN : RequestType.ADVANCE;
      const amount = 1000 + (w.n % 5) * 500; // 1000..3000 ILS
      const req = await prisma.workerRequest.create({
        data: {
          workerId: worker.id,
          type,
          amount,
          currency: 'ILS',
          notes: `${REQUEST_MARKER} ${typePick.toLowerCase()} request`,
          ...resolved,
        },
      });
      if (status === RequestStatus.APPROVED) {
        // Consistent tagged ledger row (outstanding = amount, requestId set) exactly
        // as applyApprovalEffect materializes it.
        const ledger = {
          workerId: worker.id,
          amount,
          currency: 'ILS',
          date: d(iso(now)),
          notes: `${REQUEST_MARKER} approved ${typePick.toLowerCase()}`,
          outstanding: amount,
          requestId: req.id,
        };
        if (type === RequestType.LOAN) {
          await prisma.loan.create({ data: ledger });
          reqStats.approvedLoan++;
        } else {
          await prisma.advancePayment.create({ data: ledger });
          reqStats.approvedAdvance++;
        }
      } else if (status === RequestStatus.REJECTED) {
        reqStats.rejected++;
      } else if (type === RequestType.LOAN) {
        reqStats.pendingLoan++;
      } else {
        reqStats.pendingAdvance++;
      }
    }
  }

  // ── Verification counts (live DB) ───────────────────────────────────────────
  const rangeEmails = specs.map((s) => emailFor(s.n));
  const [
    batchWorkerUsers,
    batchWorkersLinked,
    batchAttendance,
    batchRequests,
    totalWorkers,
    totalWorkerUsers,
  ] = await Promise.all([
    prisma.user.count({ where: { role: 'WORKER', email: { in: rangeEmails } } }),
    prisma.worker.count({ where: { email: { in: rangeEmails }, userId: { not: null } } }),
    prisma.attendanceRecord.count({ where: { worker: { email: { in: rangeEmails } } } }),
    prisma.workerRequest.count({ where: { worker: { email: { in: rangeEmails } } } }),
    prisma.worker.count(),
    prisma.user.count({ where: { role: 'WORKER' } }),
  ]);

  console.log('\n✔ seed-employees-plus complete.');
  console.table({ created, skipped, failed, attendanceWritten });
  console.log('Requests by type + status:');
  console.table(reqStats);
  console.log('Batch (worker21..100) live DB verification:');
  console.table({
    batchWorkerRoleUsers: batchWorkerUsers,
    batchWorkersLinkedToLogin: batchWorkersLinked,
    batchAttendanceRows: batchAttendance,
    batchRequestRows: batchRequests,
  });
  console.log('Global totals:');
  console.table({ totalWorkers, totalWorkerRoleUsers: totalWorkerUsers });
  console.log(`\nDEMO login password (demo-only, non-secret): ${DEMO_PASSWORD}`);
  console.log(`DEMO login emails (this batch): worker${N_START}@${EMAIL_DOMAIN} … worker${N_END}@${EMAIL_DOMAIN}`);
  if (!resolver) {
    console.warn('⚠ No ADMIN/MANAGER user found — APPROVED requests were left without a resolvedById.');
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('✖ seed-employees-plus failed:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
