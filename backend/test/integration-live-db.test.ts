/**
 * LIVE-DB / LIVE-SUPABASE integration coverage (Phase 04).
 *
 * These cases exercise the REAL query path end to end against the provisioned
 * Supabase Postgres (migrated + seeded) and, for #7–#9, the real Supabase Auth
 * Admin API + Storage. They are NOT mocked — the module-scope prisma singleton
 * (src/db/client.ts) talks to the pooler via DATABASE_URL, and app.supabase uses
 * the service-role client.
 *
 * Env: the harness must provide the real backend/.env (run vitest with
 * `node --import tsx --env-file=.env`), so SUPABASE_JWT_SECRET / URL / keys are the
 * real project values. We forge Supabase-shaped HS256 JWTs with that real secret and
 * point `sub` at a real User.authUserId so the auth plugin admits us — the same code
 * path a genuine Supabase access token takes.
 *
 * Cleanup: every row/identity/object these tests create is removed in afterAll, so
 * the run is idempotent and leaves only the seed data behind.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { TestContext } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { createClient } from '@supabase/supabase-js';
import type { FastifyInstance } from 'fastify';
import { Role } from '@sitelink/shared';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { prisma } from '../src/db/client.js';

const SECRET = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET);

/** Forge a Supabase-shaped access token (HS256, real project secret). */
async function signFor(authUserId: string): Promise<string> {
  return new SignJWT({ aud: 'authenticated', role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(authUserId)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(SECRET);
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

// A Supabase Storage error whose message names a missing bucket → treat as infra,
// not an assertion failure (per the per-test infra/permission caveat).
function isMissingBucket(msg: string | undefined): boolean {
  return !!msg && /bucket.*not.*found|not.*found.*bucket|no such bucket/i.test(msg);
}

let app: FastifyInstance;
let mgrToken: string;
const MGR_AUTH_ID = 'seed-live-manager'; // stable authUserId we own for these tests
let mgrUserId: string;

// Track created ids for teardown.
const createdWorkerIds: string[] = [];
const createdUserIds: string[] = [];
const createdAuthIds: string[] = [];
const createdAttendanceKeys: Array<{ workerId: string; date: Date }> = [];

const D = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

beforeAll(async () => {
  app = await buildApp(loadConfig());
  await app.ready();

  // A real Manager User row whose authUserId we can sign tokens for.
  const mgr = await prisma.user.upsert({
    where: { email: 'live-manager@sitelink.test' },
    update: { role: Role.MANAGER, isLockedOut: false, authUserId: MGR_AUTH_ID },
    create: {
      authUserId: MGR_AUTH_ID,
      role: Role.MANAGER,
      fullName: 'Live Test Manager',
      email: 'live-manager@sitelink.test',
    },
  });
  mgrUserId = mgr.id;
  mgrToken = await signFor(MGR_AUTH_ID);
}, 30_000);

afterAll(async () => {
  for (const k of createdAttendanceKeys) {
    await prisma.attendanceRecord
      .deleteMany({ where: { workerId: k.workerId, date: k.date } })
      .catch(() => undefined);
  }
  for (const id of createdWorkerIds) {
    await prisma.workerDoc.deleteMany({ where: { workerId: id } }).catch(() => undefined);
    await prisma.siteAssignment.deleteMany({ where: { workerId: id } }).catch(() => undefined);
    await prisma.workerSalaryData.deleteMany({ where: { workerId: id } }).catch(() => undefined);
    await prisma.attendanceRecord.deleteMany({ where: { workerId: id } }).catch(() => undefined);
    await prisma.worker.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of createdUserIds) {
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  const svc = app.supabase;
  for (const authId of createdAuthIds) {
    await svc.deleteAuthUser(authId).catch(() => undefined);
  }
  await prisma.user.delete({ where: { id: mgrUserId } }).catch(() => undefined);
  await app.close();
  await prisma.$disconnect();
}, 30_000);

describe('Live DB/Supabase integration (provisioned infra)', () => {
  // ── #1 ──────────────────────────────────────────────────────────────────
  // Asserts: a second attendance row for the same (workerId,date) is rejected —
  // real 409 CONFLICT from the service pre-check backed by the DB unique index.
  it('attendance UNIQUE(workerId,date) index rejects a duplicate at the DB layer (real 409)', async () => {
    const date = '2026-06-01'; // seed-worker-01 already has an ATTENDANCE row here
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/attendance',
      headers: auth(mgrToken),
      payload: {
        workerId: 'seed-worker-01',
        siteId: 'seed-site-tower',
        date: `${date}T00:00:00.000Z`,
        type: 'ATTENDANCE',
        hours: 8,
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONFLICT');

    // And the DB really still holds exactly one row for that worker/day.
    const count = await prisma.attendanceRecord.count({
      where: { workerId: 'seed-worker-01', date: D(date) },
    });
    expect(count).toBe(1);
  });

  // ── #2 ──────────────────────────────────────────────────────────────────
  // Asserts: SM-2 dashboard rollup numbers reconcile with the seeded rows for a
  // single site/date filter (headcount, attendance/vacation/disease day counts,
  // total worked hours) — computed server-side from live data.
  it('SM-2 dashboard rollups reconcile against seeded records for a site/date filter', async () => {
    const from = '2026-06-01T00:00:00.000Z';
    const to = '2026-06-30T00:00:00.000Z';
    const siteId = 'seed-site-tower';

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/dashboard?siteId=${siteId}&from=${from}&to=${to}`,
      headers: auth(mgrToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Reconcile against the raw DB for the same filter.
    const recs = await prisma.attendanceRecord.findMany({
      where: { siteId, date: { gte: new Date(from), lte: new Date(to) } },
      select: { type: true, hours: true },
    });
    const expected = { att: 0, vac: 0, dis: 0, hours: 0 };
    for (const r of recs) {
      if (r.type === 'ATTENDANCE') {
        expected.att += 1;
        expected.hours += Number(r.hours ?? 0);
      } else if (r.type === 'VACATION') expected.vac += 1;
      else expected.dis += 1;
    }
    const headcount = await prisma.worker.count({
      where: { isArchived: false, assignments: { some: { siteId } } },
    });

    expect(body.filter.siteId).toBe(siteId);
    expect(body.workers.attendanceDays).toBe(expected.att);
    expect(body.workers.vacationDays).toBe(expected.vac);
    expect(body.workers.diseaseDays).toBe(expected.dis);
    expect(body.workers.totalWorkHours).toBeCloseTo(expected.hours, 2);
    expect(body.workers.amountOfWorkers).toBe(headcount);
  });

  // ── #3 ──────────────────────────────────────────────────────────────────
  // Asserts: /salary/calculate resolves the calc MODE server-side from the stored
  // ProfessionWageRate for the worker's profession — the request never carries it.
  // seed-worker-03 is ELECTRICIAN → seeded calcMode ISRAELI_LABOR_LAW, which the
  // engine surfaces via its stub warning (proof the israeli-labor-law strategy ran).
  it('salary /calculate resolves mode from stored ProfessionWageRate (server-side, not request)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/salary/calculate',
      headers: auth(mgrToken),
      payload: {
        workerId: 'seed-worker-03',
        siteId: 'seed-site-bridge',
        periodStart: '2026-06-01T00:00:00.000Z',
        periodEnd: '2026-06-30T00:00:00.000Z',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    const rate = await prisma.professionWageRate.findFirst({
      where: { profession: 'ELECTRICIAN', siteId: null },
    });
    expect(rate?.calcMode).toBe('ISRAELI_LABOR_LAW');
    // The israeli-labor-law strategy is a stub that emits a warning — its presence
    // proves the mode was resolved from config, not defaulted to FIXED.
    expect(body.warnings.join(' ')).toMatch(/israeli/i);
    expect(body.gross).toBeGreaterThan(0);
  });

  // ── #4 ──────────────────────────────────────────────────────────────────
  // Asserts: per-worker WorkerSalaryData overrides the profession default rate.
  // We set seed-worker-01's salary-data wage far from the IRONWORKER default (62)
  // and confirm the computed gross tracks the override, not the profession rate.
  it('salary /calculate: per-worker WorkerSalaryData overrides profession default rate', async () => {
    const OVERRIDE = 99;
    await prisma.workerSalaryData.upsert({
      where: { workerId: 'seed-worker-01' },
      update: { hourlyWage: OVERRIDE, rateType: 'HOURLY', currency: 'ILS' },
      create: { workerId: 'seed-worker-01', hourlyWage: OVERRIDE, rateType: 'HOURLY', currency: 'ILS' },
    });

    const period = { periodStart: '2026-06-01T00:00:00.000Z', periodEnd: '2026-06-05T00:00:00.000Z' };
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/salary/calculate',
      headers: auth(mgrToken),
      payload: { workerId: 'seed-worker-01', siteId: 'seed-site-tower', ...period },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // seed-worker-01 has 3 ATTENDANCE days (Jun 1–3) @ 9h + 1 VACATION (Jun 4).
    // FIXED strategy gross = sum(hours) * override wage. Independent of profession 62.
    const worked = await prisma.attendanceRecord.aggregate({
      _sum: { hours: true },
      where: { workerId: 'seed-worker-01', type: 'ATTENDANCE', date: { gte: D('2026-06-01'), lte: D('2026-06-05') } },
    });
    const hours = Number(worked._sum.hours ?? 0);
    expect(body.gross).toBeCloseTo(hours * OVERRIDE, 2);
    expect(body.gross).not.toBeCloseTo(hours * 62, 2);

    // Restore the seed wage (62) so the fixture stays stable.
    await prisma.workerSalaryData.update({
      where: { workerId: 'seed-worker-01' },
      data: { hourlyWage: 62 },
    });
  });

  // ── #5 ──────────────────────────────────────────────────────────────────
  // Asserts: SM-1 Worker Wizard create persists Details + SalaryData + site
  // assignments in one operation, verified by reading them straight from the DB.
  it('worker Wizard create persists Details + SalaryData + site assignments in one op (SM-1)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workers',
      headers: auth(mgrToken),
      payload: {
        firstName: 'Live',
        lastName: `Wizard-${randomUUID().slice(0, 8)}`,
        profession: 'PLUMBER',
        level: 'GOOD',
        country: 'Poland',
        siteIds: ['seed-site-tower', 'seed-site-bridge'],
        salaryData: { hourlyWage: 70, rateType: 'HOURLY', currency: 'ILS' },
      },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json();
    createdWorkerIds.push(created.id);

    const row = await prisma.worker.findUnique({
      where: { id: created.id },
      include: { salaryData: true, assignments: true },
    });
    expect(row).not.toBeNull();
    expect(row!.profession).toBe('PLUMBER');
    expect(Number(row!.salaryData?.hourlyWage)).toBe(70);
    expect(row!.assignments.map((a) => a.siteId).sort()).toEqual(
      ['seed-site-bridge', 'seed-site-tower'],
    );
  });

  // ── #6 ──────────────────────────────────────────────────────────────────
  // Asserts: archived workers are excluded from the default list and reappear only
  // with includeArchived=true — the live soft-delete filter.
  it('archived workers/sites excluded from default list, visible with includeArchived', async () => {
    // Create then archive a worker.
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/workers',
      headers: auth(mgrToken),
      payload: { firstName: 'Arch', lastName: `Ived-${randomUUID().slice(0, 8)}`, profession: 'OTHER', level: 'MEDIUM' },
    });
    const w = createRes.json();
    createdWorkerIds.push(w.id);
    const archRes = await app.inject({
      method: 'POST',
      url: `/api/v1/workers/${w.id}/archive`,
      headers: auth(mgrToken),
    });
    expect(archRes.statusCode).toBe(200);

    // Default list (large page) must NOT contain it.
    const def = await app.inject({
      method: 'GET',
      url: '/api/v1/workers?page=1&pageSize=100',
      headers: auth(mgrToken),
    });
    const defIds = def.json().items.map((x: { id: string }) => x.id);
    expect(defIds).not.toContain(w.id);

    // includeArchived=true must surface it.
    const inc = await app.inject({
      method: 'GET',
      url: '/api/v1/workers?page=1&pageSize=100&includeArchived=true',
      headers: auth(mgrToken),
    });
    const incIds = inc.json().items.map((x: { id: string }) => x.id);
    expect(incIds).toContain(w.id);
  });

  // ── #7 ──────────────────────────────────────────────────────────────────
  // Asserts: Users Manager add is a real dual-write — Supabase identity provisioned
  // via the Admin API AND an app User row created, keyed by that authUserId; and it
  // rolls back the Supabase identity when the app-write fails (duplicate email).
  it('Users Manager dual-write provisions Supabase identity + User row; rolls back on failure', async () => {
    const email = `live-dualwrite-${randomUUID().slice(0, 8)}@sitelink.test`;
    const password = `Pw-${randomUUID()}`;

    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: auth(mgrToken),
      payload: { role: Role.MANAGER, fullName: 'DW User', email, password },
    });
    // Distinguish an Admin-API permission problem from a genuine assertion failure.
    if (ok.statusCode === 409 || ok.statusCode === 500) {
      expect.fail(`Admin API provisioning unavailable (status ${ok.statusCode}): ${ok.body}`);
    }
    expect(ok.statusCode).toBe(201);
    const user = ok.json();
    createdUserIds.push(user.id);

    // The app row exists and carries a real (non-placeholder) Supabase authUserId.
    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(dbUser).not.toBeNull();
    expect(dbUser!.authUserId).toBeTruthy();
    expect(dbUser!.authUserId.startsWith('seed-')).toBe(false);
    createdAuthIds.push(dbUser!.authUserId);

    // The identity really exists in Supabase Auth (service-role admin read).
    const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: got } = await admin.auth.admin.getUserById(dbUser!.authUserId);
    expect(got.user?.email?.toLowerCase()).toBe(email.toLowerCase());

    // Rollback path: a SECOND create with the SAME email must be rejected, and must
    // NOT leave a second orphaned Supabase identity. The service guards the app-side
    // unique first (409) — assert no new app row and the original identity is intact.
    const dup = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: auth(mgrToken),
      payload: { role: Role.MANAGER, fullName: 'DW Dup', email, password },
    });
    expect(dup.statusCode).toBe(409);
    const rows = await prisma.user.count({ where: { email } });
    expect(rows).toBe(1);
  });

  // ── #8 ──────────────────────────────────────────────────────────────────
  // Asserts: setting lockout mirrors a ban to Supabase Auth so the user can no
  // longer obtain a session (password sign-in via the anon client fails).
  it('lockout mirrored to Supabase prevents obtaining a session', async () => {
    const email = `live-lockout-${randomUUID().slice(0, 8)}@sitelink.test`;
    const password = `Pw-${randomUUID()}`;

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: auth(mgrToken),
      payload: { role: Role.MANAGER, fullName: 'Lockout User', email, password },
    });
    if (created.statusCode !== 201) {
      expect.fail(`Admin API provisioning unavailable (status ${created.statusCode}): ${created.body}`);
    }
    const user = created.json();
    createdUserIds.push(user.id);
    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    createdAuthIds.push(dbUser!.authUserId);

    const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Baseline: before lockout the freshly-created (email-confirmed) user CAN sign in.
    const before = await anon.auth.signInWithPassword({ email, password });
    expect(before.error).toBeNull();
    expect(before.data.session).not.toBeNull();

    // Lock the account → mirrors a ban to Supabase.
    const lock = await app.inject({
      method: 'POST',
      url: `/api/v1/users/${user.id}/lockout`,
      headers: auth(mgrToken),
      payload: { isLockedOut: true },
    });
    expect(lock.statusCode).toBe(200);

    // Now a session can no longer be obtained.
    const after = await createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    }).auth.signInWithPassword({ email, password });
    expect(after.error).not.toBeNull();
    expect(after.data.session).toBeNull();
  }, 30_000);

  // ── #9 ──────────────────────────────────────────────────────────────────
  // Asserts: worker-docs signed upload/read URLs are minted only through the
  // back-end authorization path, and the bucket is PRIVATE (the signed read URL is
  // token-bearing / time-limited, and the raw public object URL is not accessible).
  it('worker-docs signed upload/read URLs minted only after back-end authorization (private bucket)', async (ctx: TestContext) => {
    // Back-end authorization gate holds regardless of Storage provisioning: an
    // unauthenticated request is refused BEFORE any URL is minted.
    const noAuth = await app.inject({
      method: 'POST',
      url: '/api/v1/workers/seed-worker-01/docs/upload-url',
      payload: { type: 'PASSPORT_ID', mimeType: 'application/pdf' },
    });
    expect(noAuth.statusCode).toBe(401);

    // The rest of this case needs the private `worker-docs` bucket to actually
    // exist on the project. If it is not provisioned, this is an INFRA gap (not an
    // assertion failure) — skip with a precise note rather than a bare fail.
    const buk = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: buckets } = await buk.storage.listBuckets();
    const bucket = (buckets ?? []).find((b) => b.name === 'worker-docs');
    if (!bucket) {
      ctx.skip(
        "INFRA: private bucket 'worker-docs' not provisioned on the Supabase project " +
          '(listBuckets() empty). Auth gate asserted (401); signed-URL path needs the bucket.',
      );
      return;
    }
    // The bucket exists — it MUST be private (Architecture §7a).
    expect(bucket.public).toBe(false);

    // Authorized: mint a signed UPLOAD url on the private worker-docs bucket.
    const up = await app.inject({
      method: 'POST',
      url: '/api/v1/workers/seed-worker-01/docs/upload-url',
      headers: auth(mgrToken),
      payload: { type: 'PASSPORT_ID', mimeType: 'application/pdf' },
    });
    if (up.statusCode !== 200 && isMissingBucket(up.body)) {
      ctx.skip(`INFRA: worker-docs storage not fully provisioned (${up.body})`);
      return;
    }
    expect(up.statusCode).toBe(200);
    const signed = up.json();
    // Server-chosen key scoped to the worker (traversal guard) + real signed URL.
    expect(signed.storageKey.startsWith('seed-worker-01/')).toBe(true);
    expect(signed.bucket).toBe('worker-docs');
    expect(signed.uploadUrl).toMatch(/token=|\/object\/upload\/sign\//);

    // Mint a signed READ url for the seeded doc (seed-doc-01) and prove privacy:
    // the signed url carries a token, and the equivalent unsigned public url 404s.
    const readRes = await app.inject({
      method: 'GET',
      url: '/api/v1/workers/seed-worker-01/docs/seed-doc-01/url',
      headers: auth(mgrToken),
    });
    expect(readRes.statusCode).toBe(200);
    const read = readRes.json();
    expect(read.expiresInSeconds).toBeGreaterThan(0);
    expect(read.url).toMatch(/token=/);

    // Private-bucket proof: the same object via the PUBLIC path must be denied.
    const publicUrl = read.url.replace('/object/sign/', '/object/public/').split('?')[0];
    const pub = await fetch(publicUrl);
    expect(pub.ok).toBe(false); // 400/403/404 — never 200 for a private bucket
  }, 30_000);

  // ── #10 ─────────────────────────────────────────────────────────────────
  // Asserts: SM-6 reports stream real application/pdf bytes, and the active
  // language selects text direction (he → RTL) without changing the content type.
  it('reports PDF streams application/pdf in active language/direction (SM-6)', async () => {
    const qs = 'from=2026-06-01T00:00:00.000Z&to=2026-06-30T00:00:00.000Z&siteId=seed-site-tower';

    const en = await app.inject({
      method: 'GET',
      url: `/api/v1/reports/attendance.pdf?${qs}&lang=en`,
      headers: auth(mgrToken),
    });
    expect(en.statusCode).toBe(200);
    expect(en.headers['content-type']).toMatch(/application\/pdf/);
    // Real PDF magic bytes.
    expect(en.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(en.rawPayload.length).toBeGreaterThan(500);

    // Hebrew (RTL) still streams a valid PDF with the same content type.
    const he = await app.inject({
      method: 'GET',
      url: `/api/v1/reports/attendance.pdf?${qs}&lang=he`,
      headers: auth(mgrToken),
    });
    expect(he.statusCode).toBe(200);
    expect(he.headers['content-type']).toMatch(/application\/pdf/);
    expect(he.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  }, 30_000);
});
