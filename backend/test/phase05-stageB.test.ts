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
      primarySiteId: SITE_A,
    },
    create: {
      authUserId: FOREMAN_A_AUTH,
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
      primarySiteId: SITE_B,
    },
    create: {
      authUserId: FOREMAN_B_AUTH,
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
      login: { email: workerLoginEmail, password: `Pw-${randomUUID()}`, fullName: 'StageB Worker Login' },
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
});
