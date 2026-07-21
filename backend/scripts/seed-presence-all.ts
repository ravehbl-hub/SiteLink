/**
 * SiteLink — ENTRY/EXIT PRESENCE seeder for ALL workers (Savant/DB, user-approved).
 *
 * For EVERY non-archived worker, ensure:
 *   1. SITE — the worker is assigned to at least one active site (round-robin over the
 *      worker's OWN-company sites if they have none), and
 *   2. PRESENCE — an entry/exit (checkIn/checkOut) attendance record for each recent
 *      working day (Mon–Fri) of the CURRENT month up to today.
 *
 * "PRESENCE ONLY" (product decision): presence rows carry checkIn + checkOut times but
 * `hours = null` — pure presence, NOT counted toward pay (mirrors the app's design that
 * clock-in/out is presence/display only; manual `hours` stays the source of truth for pay).
 *
 * NON-DESTRUCTIVE + IDEMPOTENT (critical — the live DB already has seeded hours):
 *   - A day with NO record  → CREATE a presence-only row (type ATTENDANCE, hours null,
 *     checkIn/checkOut set, siteId stamped, notes marker "[seed-presence]").
 *   - A day WITH a record   → only PATCH the gaps: add checkIn/checkOut ONLY if BOTH are
 *     currently null, and add siteId ONLY if it is currently null. NEVER touches an
 *     existing row's hours / type / notes / already-set times or site. So existing
 *     working-hours data (seed-employees-plus) is preserved byte-for-byte.
 *   - Re-runs are stable: the same rows are found and left as-is.
 *
 * TENANCY: AttendanceRecord.companyId is stamped from the worker; the stamped siteId is
 * always a site in the WORKER'S OWN company (never a cross-tenant site FK).
 *
 * REVERSIBLE: rows CREATED here are identifiable by notes = "[seed-presence]":
 *     await prisma.attendanceRecord.deleteMany({ where: { notes: '[seed-presence]' } })
 *   (Gap-patched checkIn/checkOut on pre-existing rows are not auto-reverted — they only
 *   ADD entry/exit where a row previously had none.)
 *
 *   Run (sandbox-disabled, from backend/):  npx tsx scripts/seed-presence-all.ts
 */
import 'dotenv/config';

import { prisma } from '../src/db/client.js';
import { AttendanceType } from '../src/generated/prisma/client.js';

/** Stable marker so CREATED presence rows are identifiable + reversible. */
const PRESENCE_MARKER = '[seed-presence]';

/** ISO YYYY-MM-DD for a Date (UTC). */
function iso(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}

/** UTC-midnight Date for a YYYY-MM-DD string (@db.Date columns store date-only). */
function dateOnly(isoDay: string): Date {
  return new Date(`${isoDay}T00:00:00.000Z`);
}

/** Full DateTime on a given day at HH:MM (UTC) — used for checkIn/checkOut. */
function at(isoDay: string, hh: number, mm: number): Date {
  return new Date(`${isoDay}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00.000Z`);
}

/**
 * Most-recent working days (Mon–Fri) of the CURRENT month, up to `count`, never future.
 * Ascending ISO strings. `now` passed in for determinism within a run.
 */
function recentWorkingDays(now: Date, count: number): string[] {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const today = now.getUTCDate();
  const days: string[] = [];
  for (let day = today; day >= 1 && days.length < count; day--) {
    const dt = new Date(Date.UTC(year, month, day));
    const dow = dt.getUTCDay();
    if (dow === 0 || dow === 6) continue; // skip Sun/Sat
    days.push(iso(dt));
  }
  return days.reverse();
}

/**
 * Deterministic entry/exit for a worker (varied but stable across runs). Entry 06:30–08:15,
 * exit 15:30–17:15, in 15-min steps keyed off the worker's index → realistic spread.
 */
function shiftFor(index: number): { in: [number, number]; out: [number, number] } {
  const inSlot = index % 8; // 0..7 → 06:30 + slot*15min
  const outSlot = index % 8;
  const inMinutes = 6 * 60 + 30 + inSlot * 15;
  const outMinutes = 15 * 60 + 30 + outSlot * 15;
  return {
    in: [Math.floor(inMinutes / 60), inMinutes % 60],
    out: [Math.floor(outMinutes / 60), outMinutes % 60],
  };
}

async function main() {
  const now = new Date();
  // count=31 → every working day from the 1st through today (recentWorkingDays caps at today).
  const days = recentWorkingDays(now, 31);
  if (days.length === 0) {
    console.log('No working days so far this month — nothing to seed.');
    return;
  }
  console.log(`▶ Presence window: ${days[0]} … ${days[days.length - 1]} (${days.length} working days)`);

  // All ACTIVE (non-archived) workers with their company + active site assignments.
  const workers = await prisma.worker.findMany({
    where: { isArchived: false },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      companyId: true,
      assignments: {
        where: { unassignedAt: null },
        select: { siteId: true },
        orderBy: { assignedAt: 'asc' },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`▶ ${workers.length} active workers.`);

  // Active sites grouped by company, for round-robin assignment of site-less workers.
  const sites = await prisma.site.findMany({
    where: { isArchived: false, status: 'ACTIVE' },
    select: { id: true, companyId: true },
    orderBy: { createdAt: 'asc' },
  });
  const sitesByCompany = new Map<string, string[]>();
  for (const s of sites) {
    const list = sitesByCompany.get(s.companyId) ?? [];
    list.push(s.id);
    sitesByCompany.set(s.companyId, list);
  }

  let assignmentsCreated = 0;
  let presenceCreated = 0;
  let presencePatched = 0;
  let skippedNoSite = 0;

  for (let i = 0; i < workers.length; i++) {
    const w = workers[i];

    // Resolve the worker's presence site: their first active assignment, else round-robin
    // a site from their OWN company (and create that assignment so they're not site-less).
    let siteId = w.assignments[0]?.siteId ?? null;
    if (!siteId) {
      const companySites = sitesByCompany.get(w.companyId) ?? [];
      if (companySites.length === 0) {
        skippedNoSite++;
        console.warn(`  ! ${w.firstName} ${w.lastName} (${w.id}) — company has no active site; skipping.`);
        continue;
      }
      siteId = companySites[i % companySites.length];
      await prisma.siteAssignment.upsert({
        where: { siteId_workerId: { siteId, workerId: w.id } },
        create: { siteId, workerId: w.id },
        update: { unassignedAt: null },
      });
      assignmentsCreated++;
    }

    const shift = shiftFor(i);

    for (const day of days) {
      const date = dateOnly(day);
      const checkIn = at(day, shift.in[0], shift.in[1]);
      const checkOut = at(day, shift.out[0], shift.out[1]);

      const existing = await prisma.attendanceRecord.findUnique({
        where: { workerId_date: { workerId: w.id, date } },
        select: { id: true, checkIn: true, checkOut: true, siteId: true },
      });

      if (!existing) {
        // Brand-new day → presence-only row (hours null; entry/exit + site set).
        await prisma.attendanceRecord.create({
          data: {
            workerId: w.id,
            companyId: w.companyId,
            siteId,
            date,
            type: AttendanceType.ATTENDANCE,
            hours: null,
            checkIn,
            checkOut,
            notes: PRESENCE_MARKER,
          },
        });
        presenceCreated++;
        continue;
      }

      // Existing row → PATCH GAPS ONLY. Never null hours; never overwrite set times/site.
      const patch: { checkIn?: Date; checkOut?: Date; siteId?: string } = {};
      if (existing.checkIn == null && existing.checkOut == null) {
        patch.checkIn = checkIn;
        patch.checkOut = checkOut;
      }
      if (existing.siteId == null) {
        patch.siteId = siteId;
      }
      if (Object.keys(patch).length > 0) {
        await prisma.attendanceRecord.update({ where: { id: existing.id }, data: patch });
        presencePatched++;
      }
    }
  }

  console.log('\n── Done ──────────────────────────────────────────────');
  console.log(`  site assignments created : ${assignmentsCreated}`);
  console.log(`  presence rows CREATED    : ${presenceCreated}  (notes "${PRESENCE_MARKER}")`);
  console.log(`  existing rows GAP-PATCHED: ${presencePatched}  (added entry/exit or site)`);
  if (skippedNoSite > 0) console.log(`  workers skipped (no site): ${skippedNoSite}`);
  console.log('──────────────────────────────────────────────────────');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
