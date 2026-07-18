/**
 * SiteLink — Savant Part-1 perf measurement harness (throwaway, sandbox-disabled).
 *
 * Times the two hottest READ endpoints against the LIVE Supabase pooler so we can
 * report concrete before/after latency for the DB index + query-efficiency pass:
 *   1. Dashboard rollup for a real site + current-month window (the biggest one —
 *      joins attendance/workers/loans/advances and runs the salary engine per worker).
 *   2. Workers list page 1 (list endpoint with pagination + orderBy createdAt).
 *
 * Run:  node --import tsx --env-file=.env scripts/perf-measure.ts
 * Does NOT mutate data. Prints ms only (no secret values).
 */
import { prisma } from '../src/db/client.js';
import { DashboardService } from '../src/modules/dashboard/service.js';

// workers.list mirror — the service's list() uses only prisma (no Supabase), so we
// replicate its exact query shape here to avoid constructing SupabaseService (which
// needs storage env we don't want to touch). Same where/skip/take/orderBy.
async function workersListQuery(page: number, pageSize: number): Promise<number> {
  const where = { isArchived: false };
  const skip = (page - 1) * pageSize;
  const [rows] = await Promise.all([
    prisma.worker.findMany({ where, skip, take: pageSize, orderBy: { createdAt: 'desc' } }),
    prisma.worker.count({ where }),
  ]);
  return rows.length;
}

function monthWindow(): { from: string; to: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { from: start.toISOString(), to: now.toISOString() };
}

async function timeIt<T>(label: string, runs: number, fn: () => Promise<T>): Promise<void> {
  // Warm-up (prime pooler + plan cache) then measure N runs.
  await fn();
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    await fn();
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const avg = times.reduce((s, x) => s + x, 0) / times.length;
  const median = times[Math.floor(times.length / 2)];
  console.log(
    `${label}: median=${median.toFixed(0)}ms avg=${avg.toFixed(0)}ms min=${times[0].toFixed(0)}ms max=${times[times.length - 1].toFixed(0)}ms (n=${runs})`,
  );
}

async function main(): Promise<void> {
  const win = monthWindow();

  // Pick a real site that has attendance in the window (biggest rollup surface).
  const site = await prisma.site.findFirst({ where: { isArchived: false }, select: { id: true, name: true } });
  if (!site) {
    console.log('No site found — seed first.');
    return;
  }
  const workerCount = await prisma.worker.count({ where: { isArchived: false } });
  const attCount = await prisma.attendanceRecord.count({
    where: { date: { gte: new Date(win.from), lte: new Date(win.to) } },
  });
  const distinctWorkers = await prisma.attendanceRecord.findMany({
    where: { date: { gte: new Date(win.from), lte: new Date(win.to) } },
    select: { workerId: true },
    distinct: ['workerId'],
  });
  console.log(
    `Scope: site="${site.name}" workers(active)=${workerCount} attendanceRows(window)=${attCount} distinctWorkersWithActivity=${distinctWorkers.length}`,
  );
  console.log(`Window: ${win.from} .. ${win.to}`);
  console.log('---');

  const dashboard = new DashboardService();

  // Dashboard rollup — single concrete site (ADMIN-style all-scope with echo siteId).
  await timeIt('dashboard.rollup (all-sites)', 5, () =>
    dashboard.rollup({ from: win.from, to: win.to, revenue: 0, currency: 'ILS' } as never, { all: true }),
  );
  await timeIt('dashboard.rollup (single site)', 5, () =>
    dashboard.rollup(
      { from: win.from, to: win.to, revenue: 0, currency: 'ILS', siteId: site.id } as never,
      { siteIds: [site.id] } as never,
    ),
  );

  // Workers list — page 1.
  await timeIt('workers.list (page 1, size 50)', 8, () => workersListQuery(1, 50));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('measure error:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
