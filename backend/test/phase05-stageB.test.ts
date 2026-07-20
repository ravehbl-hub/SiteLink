/**
 * PHASE 05 — STAGE B GATE (Bugo, Back-End QA).
 *
 * LIVE-DB / LIVE-SUPABASE functional acceptance for the four Stage-B role surfaces
 * Servio built on top of the Phase-04 Manager slice. Runs the REAL query path end to
 * end against the provisioned Supabase Postgres (migrated + seeded) — nothing mocked;
 * the module-scope prisma singleton talks to the pooler and app.supabase is the real
 * service-role client.
 *
 * Auth: we forge Supabase-shaped HS256 access tokens with the REAL project
 * SUPABASE_JWT_SECRET (same pattern as integration-live-db.test.ts) whose `sub` points
 * at a real User.authUserId, so the auth plugin admits us exactly as a genuine token
 * would. Role + scope resolve from the app User row (never from the token).
 *
 * Identities provisioned for this run (all torn down in afterAll):
 *   - ADMIN     : app-provisioned via POST /users (dual-write Supabase identity).
 *   - MANAGER   : reuses/links a dedicated app User row (authUserId we sign for).
 *   - FOREMAN   : app User with role FOREMAN + primarySiteId = seed-site-tower.
 *   - WORKER    : a Worker created via POST /workers WITH a `login` block, so the
 *                 dual-write sets Worker.userId → the only safe WORKER→Worker join.
 *   - FOREMAN-2 : a second Foreman scoped to seed-site-bridge (cross-site leak probe).
 *
 * Acceptance areas: FR-FOR, FR-WRK, FR-REQ (approval loop + rollback), FR-BO.
 * Any observed scope leak (Foreman seeing another site, Worker seeing another worker)
 * is recorded as a CRITICAL FAIL via an explicit assertion.
 *
 * Cleanup: every row/identity these tests create is removed in afterAll; only seed
 * data is left behind.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import type { FastifyInstance } from 'fastify';
import { Role, RequestType, RequestStatus, AttendanceType } from '@sitelink/shared';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { prisma } from '../src/db/client.js';

const SECRET = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET);

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

// SITE_A hosts Foreman-1 + the provisioned Worker; SITE_B hosts Foreman-2 and is the
// cross-site probe target. We deliberately put SITE_A = seed-site-bridge so that this
// gate's transient fixtures never perturb the seed-site-tower headcount/rollup that the
// existing integration-live-db SM-2 test reconciles concurrently against the same DB.
const SITE_A = 'seed-site-bridge'; // Foreman-1 + Worker live here
const SITE_B = 'seed-site-tower'; // Foreman-2 lives here (cross-site probe target)
// A worker known to live on SITE_B only — used for cross-site leak/denial probes.
const SITE_B_WORKER = 'seed-worker-01'; // seed-worker-01 is on seed-site-tower

let app: FastifyInstance;

// Stable authUserIds we own & sign for (forged-token path).
const ADMIN_AUTH = `seedB-admin-${randomUUID()}`;
const MGR_AUTH = `seedB-mgr-${randomUUID()}`;
const FOREMAN_A_AUTH = `seedB-forA-${randomUUID()}`;
const FOREMAN_B_AUTH = `seedB-forB-${randomUUID()}`;

let adminToken: string;
let mgrToken: string;
let foremanAToken: string;
let foremanBToken: string;
let workerToken: string;

let adminUserId: string;
let mgrUserId: string;
let foremanAUserId: string;
let foremanBUserId: string;
let workerUserId: string; // the WORKER User row provisioned via the login block
let workerAuthId: string; // its Supabase authUserId (for token + teardown)
let workerId: string; // the Worker row id (userId links to workerUserId)
let workerLoginEmail: string;

// Teardown trackers.
const createdRequestIds: string[] = [];
const createdRatingIds: string[] = [];
const createdAttendanceIds: string[] = [];
const createdLoanIds: string[] = [];
const createdWorkerIds: string[] = [];
const createdAppUserIds: string[] = [];
const createdAuthIds: string[] = [];
// SaaS business layer (Back Office) fixtures.
const createdCustomerIds: string[] = [];

beforeAll(async () => {
  app = await buildApp(loadConfig());
  await app.ready();

  // ADMIN (app User; forged token). Direct upsert keeps teardown simple & avoids
  // depending on the Admin API for the gate's own fixtures.
  const admin = await prisma.user.upsert({
    where: { email: 'stageB-admin@sitelink.test' },
    update: { role: Role.ADMIN, isLockedOut: false, authUserId: ADMIN_AUTH },
    create: {
      authUserId: ADMIN_AUTH,
      companyId: 'cl000000000000000000default',
      role: Role.ADMIN,
      fullName: 'StageB Admin',
      email: 'stageB-admin@sitelink.test',
    },
  });
  adminUserId = admin.id;

  const mgr = await prisma.user.upsert({
    where: { email: 'stageB-manager@sitelink.test' },
    update: { role: Role.MANAGER, isLockedOut: false, authUserId: MGR_AUTH },
    create: {
      authUserId: MGR_AUTH,
      companyId: 'cl000000000000000000default',
      role: Role.MANAGER,
      fullName: 'StageB Manager',
      email: 'stageB-manager@sitelink.test',
    },
  });
  mgrUserId = mgr.id;

  // FOREMAN-1 scoped to SITE_A.
  const forA = await prisma.user.upsert({
    where: { email: 'stageB-foremanA@sitelink.test' },
    update: {
      role: Role.FOREMAN,
      isLockedOut: false,
      authUserId: FOREMAN_A_AUTH,
      companyId: 'cl000000000000000000default',
      primarySiteId: SITE_A,
    },
    create: {
      authUserId: FOREMAN_A_AUTH,
      companyId: 'cl000000000000000000default',
      role: Role.FOREMAN,
      fullName: 'StageB Foreman A',
      email: 'stageB-foremanA@sitelink.test',
      primarySiteId: SITE_A,
    },
  });
  foremanAUserId = forA.id;

  // FOREMAN-2 scoped to SITE_B (used only to prove cross-site isolation).
  const forB = await prisma.user.upsert({
    where: { email: 'stageB-foremanB@sitelink.test' },
    update: {
      role: Role.FOREMAN,
      isLockedOut: false,
      authUserId: FOREMAN_B_AUTH,
      companyId: 'cl000000000000000000default',
      primarySiteId: SITE_B,
    },
    create: {
      authUserId: FOREMAN_B_AUTH,
      companyId: 'cl000000000000000000default',
      role: Role.FOREMAN,
      fullName: 'StageB Foreman B',
      email: 'stageB-foremanB@sitelink.test',
      primarySiteId: SITE_B,
    },
  });
  foremanBUserId = forB.id;

  adminToken = await signFor(ADMIN_AUTH);
  mgrToken = await signFor(MGR_AUTH);
  foremanAToken = await signFor(FOREMAN_A_AUTH);
  foremanBToken = await signFor(FOREMAN_B_AUTH);

  // WORKER: create a Worker WITH a login (dual-write) so Worker.userId is set — the
  // ONLY safe WORKER→Worker join the self surfaces rely on. Assigned to SITE_A and
  // given salary data + attendance so the self reads have real content.
  workerLoginEmail = `stageB-worker-${randomUUID().slice(0, 8)}@sitelink.test`;
  const createWorker = await app.inject({
    method: 'POST',
    url: '/api/v1/workers',
    headers: auth(mgrToken),
    payload: {
      firstName: 'StageB',
      lastName: `Worker-${randomUUID().slice(0, 8)}`,
      profession: 'PLUMBER',
      level: 'GOOD',
      siteIds: [SITE_A],
      salaryData: { hourlyWage: 80, rateType: 'HOURLY', currency: 'ILS' },
      // Worker login is now MANDATORY and provisioned from the worker's own top-level
      // email (Phase 05 Stage C) — the old optional `login` sub-block is gone.
      email: workerLoginEmail,
      password: `Pw-${randomUUID()}`,
    },
  });
  if (createWorker.statusCode !== 201) {
    throw new Error(
      `Fixture setup FAILED: worker+login provisioning returned ${createWorker.statusCode}: ${createWorker.body}`,
    );
  }
  workerId = createWorker.json().id;
  createdWorkerIds.push(workerId);

  const workerRow = await prisma.worker.findUnique({
    where: { id: workerId },
    select: { userId: true },
  });
  workerUserId = workerRow!.userId!;
  const workerUser = await prisma.user.findUnique({ where: { id: workerUserId } });
  workerAuthId = workerUser!.authUserId;
  createdAppUserIds.push(workerUserId);
  createdAuthIds.push(workerAuthId);
  workerToken = await signFor(workerAuthId);

  // Give the worker two ATTENDANCE days so /working-hours & /salary have content.
  // Use MAY 2026 deliberately: the existing integration-live-db SM-2 test reconciles
  // seed-site-tower over JUNE 2026, and both files run against the same live DB — May
  // keeps this worker's rows out of that window so there is no cross-file race.
  for (const iso of ['2026-05-10', '2026-05-11']) {
    const rec = await prisma.attendanceRecord.create({
      data: {
        workerId,
        siteId: SITE_A,
        date: new Date(`${iso}T00:00:00.000Z`),
        type: AttendanceType.ATTENDANCE,
        hours: 8,
      },
    });
    createdAttendanceIds.push(rec.id);
  }
}, 60_000);

afterAll(async () => {
  for (const id of createdRatingIds) {
    await prisma.workerRating.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of createdRequestIds) {
    await prisma.workerRequest.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of createdLoanIds) {
    await prisma.loan.delete({ where: { id } }).catch(() => undefined);
  }
  // Any ratings/requests authored against the created worker (defensive sweep).
  for (const wId of createdWorkerIds) {
    await prisma.workerRating.deleteMany({ where: { workerId: wId } }).catch(() => undefined);
    await prisma.workerRequest.deleteMany({ where: { workerId: wId } }).catch(() => undefined);
    await prisma.loan.deleteMany({ where: { workerId: wId } }).catch(() => undefined);
    await prisma.advancePayment.deleteMany({ where: { workerId: wId } }).catch(() => undefined);
  }
  for (const id of createdAttendanceIds) {
    await prisma.attendanceRecord.delete({ where: { id } }).catch(() => undefined);
  }
  for (const wId of createdWorkerIds) {
    await prisma.attendanceRecord.deleteMany({ where: { workerId: wId } }).catch(() => undefined);
    await prisma.siteAssignment.deleteMany({ where: { workerId: wId } }).catch(() => undefined);
    await prisma.workerSalaryData.deleteMany({ where: { workerId: wId } }).catch(() => undefined);
    // Detach the login user first (Worker.userId) so we can delete both cleanly.
    await prisma.worker.update({ where: { id: wId }, data: { userId: null } }).catch(() => undefined);
    await prisma.worker.delete({ where: { id: wId } }).catch(() => undefined);
  }
  for (const id of createdAppUserIds) {
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  const svc = app.supabase;
  for (const authId of createdAuthIds) {
    await svc.deleteAuthUser(authId).catch(() => undefined);
  }
  // SaaS business-layer fixtures: Billing/Usage cascade on Customer delete.
  for (const id of createdCustomerIds) {
    await prisma.customer.delete({ where: { id } }).catch(() => undefined);
  }
  // Fixture role users.
  for (const id of [adminUserId, mgrUserId, foremanAUserId, foremanBUserId]) {
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  await app.close();
  await prisma.$disconnect();
}, 60_000);

// ════════════════════════════════════════════════════════════════════════════
// FR-FOR — Foreman surface (own-site scoped)
// ════════════════════════════════════════════════════════════════════════════
describe('FR-FOR — Foreman (own-site scoped dashboard, counts, attendance, ratings)', () => {
  it('GET /dashboard defaults to the Foreman own site and reconciles headcount', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard', // no siteId → must default to the Foreman's own site
      headers: auth(foremanAToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.filter.siteId).toBe(SITE_A); // forced to own site, not all-sites

    const headcount = await prisma.worker.count({
      where: { isArchived: false, assignments: { some: { siteId: SITE_A } } },
    });
    expect(body.workers.amountOfWorkers).toBe(headcount);
  });

  it('CRITICAL: Foreman probing another site (?siteId=SITE_B) is refused (403, no leak)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/dashboard?siteId=${SITE_B}`,
      headers: auth(foremanAToken),
    });
    expect(res.statusCode).toBe(403);
    // No site-B data must appear in the forbidden body.
    expect(JSON.stringify(res.json())).not.toContain('amountOfWorkers');
  });

  it('GET /worker-count returns only the Foreman own site', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/worker-count',
      headers: auth(foremanAToken),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json();
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.map((r: { siteId: string }) => r.siteId)).toEqual([SITE_A]);
  });

  it('Foreman lists attendance HARD-scoped to own-site workers only', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/attendance?page=1&pageSize=200',
      headers: auth(foremanAToken),
    });
    expect(res.statusCode).toBe(200);
    const items: Array<{ workerId: string }> = res.json().items;

    // Every returned row's worker must be assigned to SITE_A.
    const siteAWorkerIds = new Set(
      (
        await prisma.siteAssignment.findMany({
          where: { siteId: SITE_A, unassignedAt: null },
          select: { workerId: true },
        })
      ).map((a) => a.workerId),
    );
    for (const it of items) {
      expect(siteAWorkerIds.has(it.workerId)).toBe(true);
    }
    // CRITICAL leak probe: SITE_B_WORKER lives on SITE_B — must NOT appear.
    expect(items.some((it) => it.workerId === SITE_B_WORKER)).toBe(false);
  });

  it('Foreman can create + edit + delete attendance for an own-site worker', async () => {
    const date = '2026-07-02T00:00:00.000Z';
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/attendance',
      headers: auth(foremanAToken),
      payload: { workerId, siteId: SITE_A, date, type: 'ATTENDANCE', hours: 7 },
    });
    expect(create.statusCode).toBe(201);
    const recId = create.json().id;
    createdAttendanceIds.push(recId);

    const edit = await app.inject({
      method: 'PATCH',
      url: `/api/v1/attendance/${recId}`,
      headers: auth(foremanAToken),
      payload: { hours: 9 },
    });
    expect(edit.statusCode).toBe(200);
    expect(edit.json().hours).toBe(9);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/attendance/${recId}`,
      headers: auth(foremanAToken),
    });
    expect(del.statusCode).toBe(204);
    createdAttendanceIds.splice(createdAttendanceIds.indexOf(recId), 1);
    const gone = await prisma.attendanceRecord.findUnique({ where: { id: recId } });
    expect(gone).toBeNull();
  });

  it('CRITICAL: Foreman cannot create attendance for an off-site worker (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/attendance',
      headers: auth(foremanAToken),
      payload: {
        workerId: SITE_B_WORKER, // SITE_B worker, outside Foreman A's scope
        siteId: SITE_B,
        date: '2026-07-03T00:00:00.000Z',
        type: 'ATTENDANCE',
        hours: 8,
      },
    });
    expect(res.statusCode).toBe(403);
    const count = await prisma.attendanceRecord.count({
      where: { workerId: SITE_B_WORKER, date: new Date('2026-07-03T00:00:00.000Z') },
    });
    expect(count).toBe(0); // nothing written
  });

  it('Foreman rates an own-site worker; rating persists with server-derived foremanId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workers/${workerId}/ratings`,
      headers: auth(foremanAToken),
      // Attempt to spoof foremanId via body — must be ignored (schema omits it).
      payload: { foremanId: 'seed-worker-01', date: '2026-07-05', score: 4, notes: 'solid' },
    });
    expect(res.statusCode).toBe(201);
    const rating = res.json();
    createdRatingIds.push(rating.id);
    expect(rating.score).toBe(4);
    // foremanId is the authenticated caller, never the spoofed body value.
    expect(rating.foremanId).toBe(foremanAUserId);

    const row = await prisma.workerRating.findUnique({ where: { id: rating.id } });
    expect(row!.foremanId).toBe(foremanAUserId);
    expect(row!.workerId).toBe(workerId);

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/workers/${workerId}/ratings`,
      headers: auth(foremanAToken),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().some((r: { id: string }) => r.id === rating.id)).toBe(true);
  });

  it('CRITICAL: Foreman B (SITE_B) cannot rate the SITE_A worker (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workers/${workerId}/ratings`,
      headers: auth(foremanBToken),
      payload: { date: '2026-07-06', score: 1 },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// FR-WRK — Worker self surface
// ════════════════════════════════════════════════════════════════════════════
describe('FR-WRK — Worker sees ONLY own hours/salary/payslip + own requests', () => {
  it('GET /working-hours returns ONLY the caller worker rows', async () => {
    const res = await app.inject({
      method: 'GET',
      // Attempt to widen via ?workerId=<other> — must be ignored (self-forced).
      url: `/api/v1/working-hours?from=2026-05-01T00:00:00.000Z&to=2026-05-31T00:00:00.000Z&grain=MONTH&workerId=seed-worker-01`,
      headers: auth(workerToken),
    });
    expect(res.statusCode).toBe(200);
    const rows: Array<{ workerId: string }> = res.json();
    expect(rows.length).toBeGreaterThan(0); // the two seeded ATTENDANCE days
    for (const r of rows) expect(r.workerId).toBe(workerId);
    // CRITICAL: no other worker leaked despite the ?workerId probe.
    expect(rows.some((r) => r.workerId === 'seed-worker-01')).toBe(false);
  });

  it('POST /salary/calculate computes the caller OWN salary (self-forced workerId)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/salary/calculate',
      headers: auth(workerToken),
      // Spoof another worker — must be overridden to self.
      payload: {
        workerId: 'seed-worker-01',
        periodStart: '2026-05-01T00:00:00.000Z',
        periodEnd: '2026-05-31T00:00:00.000Z',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // 2 ATTENDANCE days @ 8h @ 80/h (PLUMBER default is FIXED) = 1280.
    expect(body.gross).toBeCloseTo(2 * 8 * 80, 2);
  });

  it('GET /reports/payslip.pdf streams the caller OWN payslip PDF', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/payslip.pdf?from=2026-05-01T00:00:00.000Z&to=2026-05-31T00:00:00.000Z&workerId=seed-worker-01&lang=en',
      headers: auth(workerToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('GET /reports/working-hours.pdf streams the caller OWN hours PDF (self-forced)', async () => {
    const res = await app.inject({
      method: 'GET',
      // Probe another worker via ?workerId — must be ignored (forced to self).
      url: '/api/v1/reports/working-hours.pdf?from=2026-05-01T00:00:00.000Z&to=2026-05-31T00:00:00.000Z&grain=month&workerId=seed-worker-01&lang=en',
      headers: auth(workerToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toMatch(/working-hours\.pdf/);
    expect(res.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('Worker submits a request (self-initiated) and sees ONLY own requests', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/requests',
      headers: auth(workerToken),
      // Spoof workerId — must be forced to the caller's own Worker.
      payload: { workerId: 'seed-worker-01', type: RequestType.VACATION, startDate: '2026-08-01T00:00:00.000Z', endDate: '2026-08-02T00:00:00.000Z' },
    });
    expect(create.statusCode).toBe(201);
    const reqBody = create.json();
    createdRequestIds.push(reqBody.id);
    expect(reqBody.workerId).toBe(workerId); // forced to self, not the spoof
    expect(reqBody.status).toBe(RequestStatus.PENDING);
    expect(reqBody.requestedById).toBe(workerUserId);

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/requests?workerId=seed-worker-01', // probe ignored
      headers: auth(workerToken),
    });
    expect(list.statusCode).toBe(200);
    const items: Array<{ workerId: string }> = list.json().items;
    for (const it of items) expect(it.workerId).toBe(workerId);
    // CRITICAL: the worker never sees another worker's requests.
    expect(items.some((it) => it.workerId === 'seed-worker-01')).toBe(false);
  });

  it('CRITICAL: Worker cannot approve a request (approve is ADMIN/MANAGER only → 403)', async () => {
    const reqId = createdRequestIds[0];
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/requests/${reqId}/approve`,
      headers: auth(workerToken),
    });
    expect(res.statusCode).toBe(403);
    const row = await prisma.workerRequest.findUnique({ where: { id: reqId } });
    expect(row!.status).toBe(RequestStatus.PENDING); // untouched
  });
});

// ════════════════════════════════════════════════════════════════════════════
// FR-REQ — request approval loop (submit → resolve), side effects + rollback
// ════════════════════════════════════════════════════════════════════════════
describe('FR-REQ — approval loop side effects, reject, and rollback', () => {
  it('approve VACATION creates AttendanceRecord(s) + APPROVED w/ resolvedById', async () => {
    const worker = await app.inject({
      method: 'POST',
      url: '/api/v1/requests',
      headers: auth(workerToken),
      payload: { type: RequestType.VACATION, startDate: '2026-09-01T00:00:00.000Z', endDate: '2026-09-02T00:00:00.000Z' },
    });
    const reqId = worker.json().id;
    createdRequestIds.push(reqId);

    const approve = await app.inject({
      method: 'PATCH',
      url: `/api/v1/requests/${reqId}/approve`,
      headers: auth(mgrToken),
      payload: { resolutionNotes: 'ok' },
    });
    expect(approve.statusCode).toBe(200);
    const body = approve.json();
    expect(body.status).toBe(RequestStatus.APPROVED);
    expect(body.resolvedById).toBe(mgrUserId);

    // Side effect: VACATION AttendanceRecord per day in [Sep 1, Sep 2].
    const days = await prisma.attendanceRecord.findMany({
      where: {
        workerId,
        type: AttendanceType.VACATION,
        date: { gte: new Date('2026-09-01T00:00:00.000Z'), lte: new Date('2026-09-02T00:00:00.000Z') },
      },
    });
    expect(days.length).toBe(2);
    for (const d of days) createdAttendanceIds.push(d.id);
  });

  it('approve LOAN creates a Loan row (amount + outstanding)', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/requests',
      headers: auth(mgrToken),
      payload: { workerId, type: RequestType.LOAN, amount: 500, currency: 'ILS' },
    });
    const reqId = create.json().id;
    createdRequestIds.push(reqId);

    const approve = await app.inject({
      method: 'PATCH',
      url: `/api/v1/requests/${reqId}/approve`,
      headers: auth(mgrToken),
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().status).toBe(RequestStatus.APPROVED);

    const loans = await prisma.loan.findMany({ where: { workerId } });
    expect(loans.length).toBeGreaterThanOrEqual(1);
    const loan = loans.find((l) => Number(l.amount) === 500);
    expect(loan).toBeTruthy();
    expect(Number(loan!.outstanding)).toBe(500);
    for (const l of loans) createdLoanIds.push(l.id);
  });

  it('approve ADVANCE creates an AdvancePayment row', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/requests',
      headers: auth(mgrToken),
      payload: { workerId, type: RequestType.ADVANCE, amount: 300, currency: 'ILS' },
    });
    const reqId = create.json().id;
    createdRequestIds.push(reqId);

    const approve = await app.inject({
      method: 'PATCH',
      url: `/api/v1/requests/${reqId}/approve`,
      headers: auth(mgrToken),
    });
    expect(approve.statusCode).toBe(200);
    const adv = await prisma.advancePayment.findFirst({ where: { workerId, amount: 300 } });
    expect(adv).toBeTruthy();
    expect(Number(adv!.outstanding)).toBe(300);
  });

  it('reject sets status only, no side effect', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/requests',
      headers: auth(mgrToken),
      payload: { workerId, type: RequestType.LOAN, amount: 999, currency: 'ILS' },
    });
    const reqId = create.json().id;
    createdRequestIds.push(reqId);

    const reject = await app.inject({
      method: 'PATCH',
      url: `/api/v1/requests/${reqId}/reject`,
      headers: auth(mgrToken),
      payload: { resolutionNotes: 'denied' },
    });
    expect(reject.statusCode).toBe(200);
    expect(reject.json().status).toBe(RequestStatus.REJECTED);
    // No Loan row for this amount was created.
    const loan = await prisma.loan.findFirst({ where: { workerId, amount: 999 } });
    expect(loan).toBeNull();
  });

  it('rollback: approving a LOAN with null amount fails and leaves status PENDING', async () => {
    // Create a PENDING LOAN with NO amount (schema allows nullish amount).
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/requests',
      headers: auth(mgrToken),
      payload: { workerId, type: RequestType.LOAN },
    });
    expect(create.statusCode).toBe(201);
    const reqId = create.json().id;
    createdRequestIds.push(reqId);

    const before = await prisma.loan.count({ where: { workerId } });

    const approve = await app.inject({
      method: 'PATCH',
      url: `/api/v1/requests/${reqId}/approve`,
      headers: auth(mgrToken),
    });
    // Side-effect validation fails → whole tx rolls back.
    expect(approve.statusCode).toBeGreaterThanOrEqual(400);

    const row = await prisma.workerRequest.findUnique({ where: { id: reqId } });
    expect(row!.status).toBe(RequestStatus.PENDING); // status NOT advanced
    expect(row!.resolvedById).toBeNull(); // resolution rolled back
    const after = await prisma.loan.count({ where: { workerId } });
    expect(after).toBe(before); // no Loan created
  });
});

// ════════════════════════════════════════════════════════════════════════════
// FR-REQ-REDECIDE — re-decide an already-RESOLVED request + SAFE side-effect reversal
// (tag-on-approve, reverse-by-requestId, idempotent flips, un-spoofable effect).
// ════════════════════════════════════════════════════════════════════════════
describe('FR-REQ-REDECIDE — re-decide + reverse-by-requestId', () => {
  // Helper: create a PENDING request (as MANAGER, on `workerId`).
  async function createRequest(payload: Record<string, unknown>): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/requests',
      headers: auth(mgrToken),
      payload: { workerId, ...payload },
    });
    expect(res.statusCode).toBe(201);
    const id = res.json().id;
    createdRequestIds.push(id);
    return id;
  }
  async function approve(reqId: string): Promise<void> {
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/requests/${reqId}/approve`,
      headers: auth(mgrToken),
    });
    expect(r.statusCode).toBe(200);
  }
  async function redecide(reqId: string, status: string, token = mgrToken) {
    return app.inject({
      method: 'PATCH',
      url: `/api/v1/requests/${reqId}/redecide`,
      headers: auth(token),
      payload: { status, resolutionNotes: `redecide ${status}` },
    });
  }

  it('(a) approve LOAN tags requestId; redecide→REJECTED reverses to 0 loans', async () => {
    const reqId = await createRequest({ type: RequestType.LOAN, amount: 111, currency: 'ILS' });
    await approve(reqId);

    const tagged = await prisma.loan.findMany({ where: { requestId: reqId } });
    expect(tagged.length).toBe(1);
    for (const l of tagged) createdLoanIds.push(l.id);

    const res = await redecide(reqId, RequestStatus.REJECTED);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe(RequestStatus.REJECTED);
    // Side effect reversed: no loan tagged to this request remains.
    expect(await prisma.loan.count({ where: { requestId: reqId } })).toBe(0);
  });

  it('(b) flip approve→reject→approve yields EXACTLY ONE tagged loan (never two)', async () => {
    const reqId = await createRequest({ type: RequestType.LOAN, amount: 222, currency: 'ILS' });
    await approve(reqId);
    expect(await prisma.loan.count({ where: { requestId: reqId } })).toBe(1);

    let res = await redecide(reqId, RequestStatus.REJECTED);
    expect(res.statusCode).toBe(200);
    expect(await prisma.loan.count({ where: { requestId: reqId } })).toBe(0);

    res = await redecide(reqId, RequestStatus.APPROVED);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe(RequestStatus.APPROVED);

    const loans = await prisma.loan.findMany({ where: { requestId: reqId } });
    expect(loans.length).toBe(1); // CRITICAL: exactly one, not two.
    for (const l of loans) createdLoanIds.push(l.id);
  });

  it('(b2) same-status re-decide is a 409 (no double side-effect)', async () => {
    const reqId = await createRequest({ type: RequestType.LOAN, amount: 223, currency: 'ILS' });
    await approve(reqId);
    for (const l of await prisma.loan.findMany({ where: { requestId: reqId } })) {
      createdLoanIds.push(l.id);
    }
    const res = await redecide(reqId, RequestStatus.APPROVED); // already APPROVED
    expect(res.statusCode).toBe(409);
    // Still exactly one loan; no double-apply.
    expect(await prisma.loan.count({ where: { requestId: reqId } })).toBe(1);
  });

  it('(c) a manually-created loan (requestId null) is NOT deleted by a reversal', async () => {
    const reqId = await createRequest({ type: RequestType.LOAN, amount: 333, currency: 'ILS' });
    await approve(reqId);
    for (const l of await prisma.loan.findMany({ where: { requestId: reqId } })) {
      createdLoanIds.push(l.id);
    }
    // Manual loan: SAME worker + SAME amount, but requestId null (untagged).
    const manual = await prisma.loan.create({
      data: { workerId, amount: 333, currency: 'ILS', date: new Date('2026-07-01'), outstanding: 333 },
    });
    createdLoanIds.push(manual.id);

    const res = await redecide(reqId, RequestStatus.REJECTED);
    expect(res.statusCode).toBe(200);
    // Tagged loan gone; manual loan UNTOUCHED (reversal is by requestId, never by amount).
    expect(await prisma.loan.count({ where: { requestId: reqId } })).toBe(0);
    expect(await prisma.loan.findUnique({ where: { id: manual.id } })).toBeTruthy();
  });

  it('(d) re-decide by a WORKER is forbidden (403) — request untouched', async () => {
    const reqId = await createRequest({ type: RequestType.LOAN, amount: 444, currency: 'ILS' });
    await approve(reqId);
    for (const l of await prisma.loan.findMany({ where: { requestId: reqId } })) {
      createdLoanIds.push(l.id);
    }
    const res = await redecide(reqId, RequestStatus.REJECTED, workerToken);
    expect(res.statusCode).toBe(403);
    const row = await prisma.workerRequest.findUnique({ where: { id: reqId } });
    expect(row!.status).toBe(RequestStatus.APPROVED); // untouched
    expect(await prisma.loan.count({ where: { requestId: reqId } })).toBe(1); // not reversed
  });

  it('(e) VACATION approve→reject removes ONLY the tagged attendance days', async () => {
    const reqId = await createRequest({
      type: RequestType.VACATION,
      startDate: '2026-10-01T00:00:00.000Z',
      endDate: '2026-10-03T00:00:00.000Z',
    });
    await approve(reqId);
    const tagged = await prisma.attendanceRecord.findMany({ where: { requestId: reqId } });
    expect(tagged.length).toBe(3);
    for (const d of tagged) createdAttendanceIds.push(d.id);

    const res = await redecide(reqId, RequestStatus.REJECTED);
    expect(res.statusCode).toBe(200);
    expect(await prisma.attendanceRecord.count({ where: { requestId: reqId } })).toBe(0);
  });

  it('(e2) ADVANCE approve→reject reverses the tagged advance', async () => {
    const reqId = await createRequest({ type: RequestType.ADVANCE, amount: 555, currency: 'ILS' });
    await approve(reqId);
    const tagged = await prisma.advancePayment.findMany({ where: { requestId: reqId } });
    expect(tagged.length).toBe(1);

    const res = await redecide(reqId, RequestStatus.REJECTED);
    expect(res.statusCode).toBe(200);
    expect(await prisma.advancePayment.count({ where: { requestId: reqId } })).toBe(0);
  });

  it('(f) partially-repaid loan reversal is BLOCKED with 409 (real-money safety)', async () => {
    const reqId = await createRequest({ type: RequestType.LOAN, amount: 666, currency: 'ILS' });
    await approve(reqId);
    const loan = (await prisma.loan.findFirst({ where: { requestId: reqId } }))!;
    createdLoanIds.push(loan.id);
    // Simulate a partial repayment: outstanding < amount.
    await prisma.loan.update({ where: { id: loan.id }, data: { outstanding: 600 } });

    const res = await redecide(reqId, RequestStatus.REJECTED);
    expect(res.statusCode).toBe(409);
    // Atomic: nothing changed — loan still present, request still APPROVED.
    expect(await prisma.loan.findUnique({ where: { id: loan.id } })).toBeTruthy();
    const row = await prisma.workerRequest.findUnique({ where: { id: reqId } });
    expect(row!.status).toBe(RequestStatus.APPROVED);
  });

  it('(g) resolvedById is re-stamped to the CALLER on each re-decide (un-spoofable)', async () => {
    const reqId = await createRequest({ type: RequestType.LOAN, amount: 777, currency: 'ILS' });
    // Approve as MANAGER first.
    await approve(reqId);
    for (const l of await prisma.loan.findMany({ where: { requestId: reqId } })) {
      createdLoanIds.push(l.id);
    }
    let row = await prisma.workerRequest.findUnique({ where: { id: reqId } });
    expect(row!.resolvedById).toBe(mgrUserId);

    // Re-decide REJECTED as ADMIN — resolvedById must flip to the admin caller, even if
    // a body tried to spoof it (body carries no resolvedById; server derives it).
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/requests/${reqId}/redecide`,
      headers: auth(adminToken),
      payload: { status: RequestStatus.REJECTED, resolvedById: mgrUserId },
    });
    expect(res.statusCode).toBe(200);
    row = await prisma.workerRequest.findUnique({ where: { id: reqId } });
    expect(row!.resolvedById).toBe(adminUserId); // re-stamped to the acting caller.
  });

  it('(h) re-decide of a still-PENDING request is a 409 (use approve/reject)', async () => {
    const reqId = await createRequest({ type: RequestType.LOAN, amount: 888, currency: 'ILS' });
    const res = await redecide(reqId, RequestStatus.APPROVED);
    expect(res.statusCode).toBe(409);
    const row = await prisma.workerRequest.findUnique({ where: { id: reqId } });
    expect(row!.status).toBe(RequestStatus.PENDING); // untouched
  });
});

// ════════════════════════════════════════════════════════════════════════════
// FR-BO — Back Office (ADMIN-only)
// ════════════════════════════════════════════════════════════════════════════
describe('FR-BO — Back Office ADMIN-only surfaces', () => {
  it('GET /backoffice/status returns liveness + DB probe (no secrets)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/backoffice/status',
      headers: auth(adminToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.db).toBe('up');
    expect(body.service).toBe('sitelink-backend');
    // No connection string / secret leaked.
    expect(JSON.stringify(body)).not.toMatch(/postgres:\/\/|DATABASE_URL|SERVICE_ROLE|password/i);
  });

  it('GET /backoffice/users excludes authUserId and password fields', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/backoffice/users',
      headers: auth(adminToken),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json();
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    for (const u of rows) {
      expect(u).not.toHaveProperty('authUserId');
      expect(u).not.toHaveProperty('password');
      expect(u).not.toHaveProperty('passwordHash');
      expect(u).toHaveProperty('email'); // expected non-secret field present
      expect(u).toHaveProperty('role');
    }
    // Belt-and-braces: no seed-/authUserId token anywhere in the payload.
    expect(JSON.stringify(rows)).not.toContain('authUserId');
  });

  it('GET /backoffice/profit-loss returns a P&L for ADMIN', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/backoffice/profit-loss?from=2026-06-01T00:00:00.000Z&to=2026-06-30T00:00:00.000Z',
      headers: auth(adminToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('netProfit');
    expect(body).toHaveProperty('salaryCost');
  });

  it('CRITICAL: non-admin (MANAGER) is refused Back Office (403)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/backoffice/users',
      headers: auth(mgrToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it('CRITICAL: Foreman is refused Back Office (403)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/backoffice/status',
      headers: auth(foremanAToken),
    });
    expect(res.statusCode).toBe(403);
  });

  // ── SaaS business layer: Customers / Billing / Usage (FR-BO-1/2/3) ──────────
  it('ADMIN can CRUD a Customer + archive/unarchive, and lists return Paginated', async () => {
    // Create
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/backoffice/customers',
      headers: auth(adminToken),
      payload: { name: `StageB Co ${randomUUID().slice(0, 8)}`, contactEmail: 'ops@stageb.test' },
    });
    expect(create.statusCode).toBe(201);
    const customer = create.json();
    createdCustomerIds.push(customer.id);
    expect(customer.isArchived).toBe(false);
    expect(customer.registeredAt).toBeTruthy();

    // Get one
    const one = await app.inject({
      method: 'GET',
      url: `/api/v1/backoffice/customers/${customer.id}`,
      headers: auth(adminToken),
    });
    expect(one.statusCode).toBe(200);
    expect(one.json().id).toBe(customer.id);

    // Update
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/backoffice/customers/${customer.id}`,
      headers: auth(adminToken),
      payload: { name: 'StageB Co RENAMED', contactPhone: '+972-50-0000000' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().name).toBe('StageB Co RENAMED');
    expect(patch.json().contactPhone).toBe('+972-50-0000000');

    // List (Paginated envelope with .items)
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/backoffice/customers?page=1&pageSize=200',
      headers: auth(adminToken),
    });
    expect(list.statusCode).toBe(200);
    const listBody = list.json();
    expect(Array.isArray(listBody.items)).toBe(true);
    expect(typeof listBody.total).toBe('number');
    expect(listBody.items.some((c: { id: string }) => c.id === customer.id)).toBe(true);

    // Archive → excluded by default, included with ?includeArchived
    const archive = await app.inject({
      method: 'POST',
      url: `/api/v1/backoffice/customers/${customer.id}/archive`,
      headers: auth(adminToken),
    });
    expect(archive.statusCode).toBe(200);
    expect(archive.json().isArchived).toBe(true);

    const defaultList = await app.inject({
      method: 'GET',
      url: '/api/v1/backoffice/customers?page=1&pageSize=200',
      headers: auth(adminToken),
    });
    expect(
      defaultList.json().items.some((c: { id: string }) => c.id === customer.id),
    ).toBe(false);

    const archivedList = await app.inject({
      method: 'GET',
      url: '/api/v1/backoffice/customers?includeArchived=true&page=1&pageSize=200',
      headers: auth(adminToken),
    });
    expect(
      archivedList.json().items.some((c: { id: string }) => c.id === customer.id),
    ).toBe(true);

    // Unarchive
    const unarchive = await app.inject({
      method: 'POST',
      url: `/api/v1/backoffice/customers/${customer.id}/unarchive`,
      headers: auth(adminToken),
    });
    expect(unarchive.statusCode).toBe(200);
    expect(unarchive.json().isArchived).toBe(false);
  });

  it('ADMIN can create Billing + Usage for a Customer; lists filter by customerId (Paginated)', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/backoffice/customers',
      headers: auth(adminToken),
      payload: { name: `StageB Billed ${randomUUID().slice(0, 8)}` },
    });
    expect(create.statusCode).toBe(201);
    const customerId = create.json().id;
    createdCustomerIds.push(customerId);

    // Billing (status defaults to TRIALING, currency ILS; amount is Decimal → number)
    const billing = await app.inject({
      method: 'POST',
      url: '/api/v1/backoffice/billing',
      headers: auth(adminToken),
      payload: {
        customerId,
        plan: 'PRO',
        amount: 199.9,
        periodStart: '2026-07-01T00:00:00.000Z',
        periodEnd: '2026-07-31T00:00:00.000Z',
      },
    });
    expect(billing.statusCode).toBe(201);
    const billBody = billing.json();
    expect(billBody.status).toBe('TRIALING');
    expect(billBody.currency).toBe('ILS');
    expect(billBody.amount).toBeCloseTo(199.9, 2);

    const billList = await app.inject({
      method: 'GET',
      url: `/api/v1/backoffice/billing?customerId=${customerId}`,
      headers: auth(adminToken),
    });
    expect(billList.statusCode).toBe(200);
    const billItems: Array<{ customerId: string }> = billList.json().items;
    expect(billItems.length).toBeGreaterThan(0);
    for (const b of billItems) expect(b.customerId).toBe(customerId);

    // Usage (value is Decimal → number)
    const usage = await app.inject({
      method: 'POST',
      url: '/api/v1/backoffice/usage',
      headers: auth(adminToken),
      payload: {
        customerId,
        metric: 'active_workers',
        value: 42,
        periodStart: '2026-07-01T00:00:00.000Z',
        periodEnd: '2026-07-31T00:00:00.000Z',
      },
    });
    expect(usage.statusCode).toBe(201);
    expect(usage.json().value).toBe(42);

    const usageList = await app.inject({
      method: 'GET',
      url: `/api/v1/backoffice/usage?customerId=${customerId}&metric=active_workers`,
      headers: auth(adminToken),
    });
    expect(usageList.statusCode).toBe(200);
    const usageItems: Array<{ customerId: string; metric: string }> = usageList.json().items;
    expect(usageItems.length).toBeGreaterThan(0);
    for (const u of usageItems) {
      expect(u.customerId).toBe(customerId);
      expect(u.metric).toBe('active_workers');
    }
  });

  it('CRITICAL: non-admin (MANAGER) is refused Customers/Billing/Usage (403, no write)', async () => {
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/backoffice/customers',
      headers: auth(mgrToken),
    });
    expect(listRes.statusCode).toBe(403);

    // Unique sentinel name so the "nothing written" probe is immune to concurrent
    // seeding (Savant seeds customers in parallel against the same live DB).
    const sentinel = `MANAGER-should-not-create-${randomUUID()}`;
    const writeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/backoffice/customers',
      headers: auth(mgrToken),
      payload: { name: sentinel },
    });
    expect(writeRes.statusCode).toBe(403);
    const leaked = await prisma.customer.count({ where: { name: sentinel } });
    expect(leaked).toBe(0); // nothing written by the forbidden request

    const billRes = await app.inject({
      method: 'GET',
      url: '/api/v1/backoffice/billing',
      headers: auth(foremanAToken),
    });
    expect(billRes.statusCode).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// FR-MGR-USER — /users privilege boundary (privilege-escalation prevention).
//
// manageableRolesFor: ADMIN ⇒ all five roles; MANAGER ⇒ {FOREMAN,WORKER,MANAGER}.
// A MANAGER can neither SEE nor ACT ON ADMIN/PARTNER users; ADMIN is unrestricted.
// Enforcement is SERVER-SIDE in the users service (list filter, ?role
// intersection, per-id 403, create/role-change restriction).
// ════════════════════════════════════════════════════════════════════════════
describe('FR-MGR-USER — /users privilege boundary (no privilege escalation)', () => {
  // A PARTNER fixture user — a MANAGER must never see or act on it.
  const PARTNER_AUTH = `seedB-partner-${randomUUID()}`;
  let partnerUserId: string;
  // A second ADMIN target the MANAGER must be refused on, and that ADMIN can act on.
  const ADMIN2_AUTH = `seedB-admin2-${randomUUID()}`;
  let admin2UserId: string;

  beforeAll(async () => {
    const partner = await prisma.user.upsert({
      where: { email: 'stageB-partner@sitelink.test' },
      update: { role: Role.PARTNER, isLockedOut: false, authUserId: PARTNER_AUTH },
      create: {
        authUserId: PARTNER_AUTH,
        companyId: 'cl000000000000000000default',
        role: Role.PARTNER,
        fullName: 'StageB Partner',
        email: 'stageB-partner@sitelink.test',
      },
    });
    partnerUserId = partner.id;
    createdAppUserIds.push(partnerUserId);

    const admin2 = await prisma.user.upsert({
      where: { email: 'stageB-admin2@sitelink.test' },
      update: { role: Role.ADMIN, isLockedOut: false, authUserId: ADMIN2_AUTH },
      create: {
        authUserId: ADMIN2_AUTH,
        companyId: 'cl000000000000000000default',
        role: Role.ADMIN,
        fullName: 'StageB Admin2',
        email: 'stageB-admin2@sitelink.test',
      },
    });
    admin2UserId = admin2.id;
    createdAppUserIds.push(admin2UserId);
  }, 60_000);

  // (a) MANAGER list excludes ADMIN/PARTNER rows.
  it('CRITICAL: MANAGER list excludes ADMIN and PARTNER rows', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users?page=1&pageSize=200',
      headers: auth(mgrToken),
    });
    expect(res.statusCode).toBe(200);
    const items: Array<{ id: string; role: string }> = res.json().items;
    for (const u of items) {
      expect(['FOREMAN', 'WORKER', 'MANAGER']).toContain(u.role);
    }
    // The specific ADMIN/PARTNER fixtures must not leak.
    expect(items.some((u) => u.id === adminUserId)).toBe(false);
    expect(items.some((u) => u.id === admin2UserId)).toBe(false);
    expect(items.some((u) => u.id === partnerUserId)).toBe(false);
  });

  // (d) MANAGER ?role=ADMIN → empty (intersection is empty).
  it('CRITICAL: MANAGER ?role=ADMIN returns an empty page (never admins)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users?role=ADMIN&page=1&pageSize=200',
      headers: auth(mgrToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('CRITICAL: MANAGER ?role=PARTNER returns an empty page (never partners)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users?role=PARTNER&page=1&pageSize=200',
      headers: auth(mgrToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual([]);
  });

  // (b) MANAGER GET/PATCH/DELETE/lockout on an ADMIN target → 403.
  it('CRITICAL: MANAGER GET on an ADMIN target → 403 (cannot view a hidden user)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${admin2UserId}`,
      headers: auth(mgrToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it('CRITICAL: MANAGER PATCH on an ADMIN target → 403, no mutation', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${admin2UserId}`,
      headers: auth(mgrToken),
      payload: { fullName: 'HACKED' },
    });
    expect(res.statusCode).toBe(403);
    const row = await prisma.user.findUnique({ where: { id: admin2UserId } });
    expect(row!.fullName).toBe('StageB Admin2'); // untouched
  });

  it('CRITICAL: MANAGER lockout on an ADMIN target → 403, no lockout', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/users/${admin2UserId}/lockout`,
      headers: auth(mgrToken),
      payload: { isLockedOut: true },
    });
    expect(res.statusCode).toBe(403);
    const row = await prisma.user.findUnique({ where: { id: admin2UserId } });
    expect(row!.isLockedOut).toBe(false); // untouched
  });

  it('CRITICAL: MANAGER DELETE on an ADMIN target → 403, row survives', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${admin2UserId}`,
      headers: auth(mgrToken),
    });
    expect(res.statusCode).toBe(403);
    const row = await prisma.user.findUnique({ where: { id: admin2UserId } });
    expect(row).not.toBeNull(); // still there
  });

  it('CRITICAL: MANAGER GET/PATCH on a PARTNER target → 403', async () => {
    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${partnerUserId}`,
      headers: auth(mgrToken),
    });
    expect(get.statusCode).toBe(403);
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${partnerUserId}`,
      headers: auth(mgrToken),
      payload: { role: 'WORKER' },
    });
    expect(patch.statusCode).toBe(403);
    const row = await prisma.user.findUnique({ where: { id: partnerUserId } });
    expect(row!.role).toBe('PARTNER'); // untouched
  });

  // (c) MANAGER create role=ADMIN / role=PARTNER → 403, nothing written.
  it('CRITICAL: MANAGER create role=ADMIN → 403, no user or identity created', async () => {
    const email = `stageB-mgr-escalate-${randomUUID().slice(0, 8)}@sitelink.test`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: auth(mgrToken),
      payload: { role: 'ADMIN', fullName: 'Should Not Exist', email, password: `Pw-${randomUUID()}` },
    });
    expect(res.statusCode).toBe(403);
    const leaked = await prisma.user.count({ where: { email } });
    expect(leaked).toBe(0); // no dual-write occurred
  });

  it('CRITICAL: MANAGER create role=PARTNER → 403', async () => {
    const email = `stageB-mgr-partner-${randomUUID().slice(0, 8)}@sitelink.test`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: auth(mgrToken),
      payload: { role: 'PARTNER', fullName: 'Nope', email, password: `Pw-${randomUUID()}` },
    });
    expect(res.statusCode).toBe(403);
    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });

  it('MANAGER cannot PATCH a manageable user TO role ADMIN (role-change guard)', async () => {
    // Target the FOREMAN fixture (in the MANAGER's set) and try to promote to ADMIN.
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${foremanAUserId}`,
      headers: auth(mgrToken),
      payload: { role: 'ADMIN' },
    });
    expect(res.statusCode).toBe(403);
    const row = await prisma.user.findUnique({ where: { id: foremanAUserId } });
    expect(row!.role).toBe('FOREMAN'); // not promoted
  });

  it('MANAGER CAN create a WORKER (in-set role succeeds)', async () => {
    const email = `stageB-mgr-worker-${randomUUID().slice(0, 8)}@sitelink.test`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: auth(mgrToken),
      payload: { role: 'WORKER', fullName: 'Mgr Made Worker', email, password: `Pw-${randomUUID()}` },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json();
    createdAppUserIds.push(created.id);
    const row = await prisma.user.findUnique({ where: { id: created.id } });
    if (row) createdAuthIds.push(row.authUserId);
    expect(created.role).toBe('WORKER');
  });

  // (e) ADMIN list ?role=ADMIN returns admins (full access).
  it('ADMIN list ?role=ADMIN returns ADMIN rows (System Admin screen use-case)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users?role=ADMIN&page=1&pageSize=200',
      headers: auth(adminToken),
    });
    expect(res.statusCode).toBe(200);
    const items: Array<{ id: string; role: string }> = res.json().items;
    expect(items.length).toBeGreaterThan(0);
    for (const u of items) expect(u.role).toBe('ADMIN');
    expect(items.some((u) => u.id === admin2UserId)).toBe(true);
  });

  it('ADMIN list (no filter) can see ADMIN and PARTNER rows (unrestricted)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users?page=1&pageSize=200',
      headers: auth(adminToken),
    });
    expect(res.statusCode).toBe(200);
    const items: Array<{ id: string }> = res.json().items;
    expect(items.some((u) => u.id === admin2UserId)).toBe(true);
    expect(items.some((u) => u.id === partnerUserId)).toBe(true);
  });

  // (f) ADMIN can create + lockout an ADMIN (full access retained).
  it('ADMIN can create an ADMIN and lock it out (full access retained)', async () => {
    const email = `stageB-admin-made-${randomUUID().slice(0, 8)}@sitelink.test`;
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: auth(adminToken),
      // Multi-tenancy Phase 1: an ADMIN create must name the target company (a user
      // must belong to a company). This ADMIN lives on the Default Company.
      payload: {
        role: 'ADMIN',
        fullName: 'Admin Made Admin',
        email,
        password: `Pw-${randomUUID()}`,
        companyId: 'cl000000000000000000default',
      },
    });
    expect(create.statusCode).toBe(201);
    const created = create.json();
    createdAppUserIds.push(created.id);
    const row = await prisma.user.findUnique({ where: { id: created.id } });
    if (row) createdAuthIds.push(row.authUserId);
    expect(created.role).toBe('ADMIN');

    const lockout = await app.inject({
      method: 'POST',
      url: `/api/v1/users/${created.id}/lockout`,
      headers: auth(adminToken),
      payload: { isLockedOut: true },
    });
    expect(lockout.statusCode).toBe(200);
    expect(lockout.json().isLockedOut).toBe(true);
  });

  it('ADMIN can GET and PATCH an ADMIN target (no privilege block for ADMIN)', async () => {
    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${admin2UserId}`,
      headers: auth(adminToken),
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().role).toBe('ADMIN');

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${admin2UserId}`,
      headers: auth(adminToken),
      payload: { fullName: 'StageB Admin2 Edited' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().fullName).toBe('StageB Admin2 Edited');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// FR-MGR-EMP — worker create now MANDATORILY provisions a WORKER login (Phase 05
// Stage C, forward-only). Email is required; every create dual-writes a Supabase
// identity + app User(role WORKER) linked via Worker.userId. No login-less create.
// ════════════════════════════════════════════════════════════════════════════
describe('FR-MGR-EMP — worker create mandatorily provisions a WORKER login', () => {
  it('creating a worker provisions a WORKER User + links Worker.userId', async () => {
    const email = `stageC-provision-${randomUUID().slice(0, 8)}@sitelink.test`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workers',
      headers: auth(mgrToken),
      payload: {
        firstName: 'StageC',
        lastName: `Provision-${randomUUID().slice(0, 8)}`,
        profession: 'ELECTRICIAN',
        level: 'MEDIUM',
        siteIds: [SITE_A],
        email,
        password: `Pw-${randomUUID()}`, // Manager-set initial password (no invite email)
      },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json();
    createdWorkerIds.push(created.id);

    // Worker.userId is linked to a freshly-provisioned WORKER User.
    const row = await prisma.worker.findUnique({
      where: { id: created.id },
      select: { userId: true, email: true },
    });
    expect(row!.email).toBe(email);
    expect(row!.userId).toBeTruthy();

    const loginUser = await prisma.user.findUnique({ where: { id: row!.userId! } });
    expect(loginUser).not.toBeNull();
    expect(loginUser!.role).toBe(Role.WORKER);
    expect(loginUser!.email).toBe(email);
    expect(loginUser!.authUserId).toBeTruthy(); // real Supabase identity

    // Track the provisioned login for teardown.
    createdAppUserIds.push(loginUser!.id);
    createdAuthIds.push(loginUser!.authUserId);
  });

  it('creating a worker WITHOUT an email is rejected (400, nothing provisioned)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workers',
      headers: auth(mgrToken),
      payload: {
        firstName: 'NoEmail',
        lastName: `Worker-${randomUUID().slice(0, 8)}`,
        profession: 'GENERAL_LABORER',
        level: 'MEDIUM',
      },
    });
    expect(res.statusCode).toBe(400); // email is now required by the create schema
  });

  it('editing the email of a worker WITH a login propagates to the linked User row', async () => {
    // `workerId` is the Stage-B provisioned worker (has a linked WORKER login).
    const newEmail = `stageC-edited-${randomUUID().slice(0, 8)}@sitelink.test`;
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workers/${workerId}`,
      headers: auth(mgrToken),
      payload: { email: newEmail },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().email).toBe(newEmail);

    // App User.email is kept in sync (Supabase identity email is intentionally NOT
    // re-keyed — flagged limitation; authUserId unchanged).
    const loginUser = await prisma.user.findUnique({ where: { id: workerUserId } });
    expect(loginUser!.email).toBe(newEmail);
    expect(loginUser!.authUserId).toBe(workerAuthId); // identity unchanged

    // Restore so downstream teardown/assertions stay stable.
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/workers/${workerId}`,
      headers: auth(mgrToken),
      payload: { email: workerLoginEmail },
    });
  });

  it('a legacy login-less worker row still reads and edits fine (no backfill)', async () => {
    // Simulate a legacy row: a Worker with NO userId (one of the 4 not backfilled).
    // Created directly at the DB layer (bypassing the now-mandatory create schema).
    const legacy = await prisma.worker.create({
      data: {
        firstName: 'Legacy',
        lastName: `NoLogin-${randomUUID().slice(0, 8)}`,
        profession: 'OTHER',
        level: 'MEDIUM',
        email: null,
        userId: null,
      },
    });
    createdWorkerIds.push(legacy.id);

    // READ works.
    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/workers/${legacy.id}`,
      headers: auth(mgrToken),
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().userId ?? null).toBeNull();

    // EDIT (a non-email field) works and does not require an email.
    const edit = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workers/${legacy.id}`,
      headers: auth(mgrToken),
      payload: { level: 'GOOD' },
    });
    expect(edit.statusCode).toBe(200);
    expect(edit.json().level).toBe('GOOD');
  });
});
