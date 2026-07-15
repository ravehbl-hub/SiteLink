/**
 * FOREMAN MULTI-SITE — union scope + Manager assignment endpoint (LIVE DB / SUPABASE).
 *
 * Servio's Foreman scope moved from a SINGLE `User.primarySiteId` to the UNION of
 * primarySiteId + active ForemanSiteAssignment rows. This suite proves, end to end
 * against the live pooler, the security invariants nexo-back will probe:
 *
 *   - A foreman with primary A + an active assignment to B can read/act on BOTH A and
 *     B, and is 403 on an UNASSIGNED site C.
 *   - After UNASSIGNING B, the foreman is 403 on B (fail-closed on scope removal).
 *   - A foreman with ONLY a primary (no assignments) still works on the primary.
 *   - An EMPTY-union foreman (no primary, no assignments) is fail-closed everywhere.
 *   - The Manager assign/unassign endpoint is MANAGER/ADMIN-gated (WORKER/FOREMAN → 403)
 *     and validates the target is a FOREMAN + the site exists.
 *
 * Everything is self-contained: this file creates its OWN sites/workers/users (never
 * seed sites) so it does not perturb the concurrent seed-reconciliation tests, and
 * tears every row/identity down in afterAll. Auth uses the same forged-HS256 token
 * pattern as phase05-stageB (real SUPABASE_JWT_SECRET; sub → a real User.authUserId).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import type { FastifyInstance } from 'fastify';
import { Role, SiteStatus } from '@sitelink/shared';

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

let app: FastifyInstance;

// Own sites (A/B in union, C the cross-site probe target).
const SITE_A = `fms-site-A-${randomUUID()}`;
const SITE_B = `fms-site-B-${randomUUID()}`;
const SITE_C = `fms-site-C-${randomUUID()}`;

// Forged-token authUserIds.
const MGR_AUTH = `fms-mgr-${randomUUID()}`;
const FOREMAN_AUTH = `fms-for-${randomUUID()}`; // primary A + assignment B
const SOLO_AUTH = `fms-solo-${randomUUID()}`; // primary A only
const EMPTY_AUTH = `fms-empty-${randomUUID()}`; // no primary, no assignments
const WORKER_AUTH = `fms-wkr-${randomUUID()}`; // a WORKER (for guard probes)

let mgrToken: string;
let foremanToken: string;
let soloToken: string;
let emptyToken: string;
let workerToken: string;

let mgrUserId: string;
let foremanUserId: string;
let soloUserId: string;
let emptyUserId: string;
let workerUserId: string;

// One worker per site (for assertWorkerInScope / ratings probes).
let workerA: string;
let workerB: string;
let workerC: string;

const createdUserIds: string[] = [];
const createdWorkerIds: string[] = [];
const createdAssignmentIds: string[] = [];

async function makeSite(id: string): Promise<void> {
  await prisma.site.create({
    data: { id, name: `FMS ${id.slice(0, 12)}`, status: SiteStatus.ACTIVE },
  });
}

async function makeWorkerOnSite(siteId: string): Promise<string> {
  const worker = await prisma.worker.create({
    data: {
      firstName: 'FMS',
      lastName: `W-${randomUUID().slice(0, 8)}`,
      profession: 'PLUMBER',
      assignments: { create: { siteId } },
    },
  });
  createdWorkerIds.push(worker.id);
  return worker.id;
}

beforeAll(async () => {
  app = await buildApp(loadConfig());
  await app.ready();

  await makeSite(SITE_A);
  await makeSite(SITE_B);
  await makeSite(SITE_C);

  const mgr = await prisma.user.create({
    data: {
      authUserId: MGR_AUTH,
      role: Role.MANAGER,
      fullName: 'FMS Manager',
      email: `fms-mgr-${randomUUID().slice(0, 8)}@sitelink.test`,
    },
  });
  mgrUserId = mgr.id;
  createdUserIds.push(mgrUserId);

  // FOREMAN: primary A + an ACTIVE assignment to B → union {A, B}.
  const foreman = await prisma.user.create({
    data: {
      authUserId: FOREMAN_AUTH,
      role: Role.FOREMAN,
      fullName: 'FMS Foreman',
      email: `fms-for-${randomUUID().slice(0, 8)}@sitelink.test`,
      primarySiteId: SITE_A,
    },
  });
  foremanUserId = foreman.id;
  createdUserIds.push(foremanUserId);
  const asgn = await prisma.foremanSiteAssignment.create({
    data: { foremanId: foremanUserId, siteId: SITE_B },
  });
  createdAssignmentIds.push(asgn.id);

  // SOLO foreman: primary A, no assignments → union {A}.
  const solo = await prisma.user.create({
    data: {
      authUserId: SOLO_AUTH,
      role: Role.FOREMAN,
      fullName: 'FMS Solo',
      email: `fms-solo-${randomUUID().slice(0, 8)}@sitelink.test`,
      primarySiteId: SITE_A,
    },
  });
  soloUserId = solo.id;
  createdUserIds.push(soloUserId);

  // EMPTY foreman: no primary, no assignments → union {} (fail-closed).
  const empty = await prisma.user.create({
    data: {
      authUserId: EMPTY_AUTH,
      role: Role.FOREMAN,
      fullName: 'FMS Empty',
      email: `fms-empty-${randomUUID().slice(0, 8)}@sitelink.test`,
    },
  });
  emptyUserId = empty.id;
  createdUserIds.push(emptyUserId);

  const worker = await prisma.user.create({
    data: {
      authUserId: WORKER_AUTH,
      role: Role.WORKER,
      fullName: 'FMS Worker',
      email: `fms-wkr-${randomUUID().slice(0, 8)}@sitelink.test`,
    },
  });
  workerUserId = worker.id;
  createdUserIds.push(workerUserId);

  workerA = await makeWorkerOnSite(SITE_A);
  workerB = await makeWorkerOnSite(SITE_B);
  workerC = await makeWorkerOnSite(SITE_C);

  mgrToken = await signFor(MGR_AUTH);
  foremanToken = await signFor(FOREMAN_AUTH);
  soloToken = await signFor(SOLO_AUTH);
  emptyToken = await signFor(EMPTY_AUTH);
  workerToken = await signFor(WORKER_AUTH);
}, 60_000);

afterAll(async () => {
  for (const wId of createdWorkerIds) {
    await prisma.workerRating.deleteMany({ where: { workerId: wId } }).catch(() => undefined);
    await prisma.siteAssignment.deleteMany({ where: { workerId: wId } }).catch(() => undefined);
    await prisma.worker.delete({ where: { id: wId } }).catch(() => undefined);
  }
  // Assignments cascade on user/site delete, but clean explicitly for safety.
  await prisma.foremanSiteAssignment
    .deleteMany({ where: { foremanId: { in: [foremanUserId, soloUserId, emptyUserId] } } })
    .catch(() => undefined);
  for (const id of createdUserIds) {
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of [SITE_A, SITE_B, SITE_C]) {
    await prisma.site.delete({ where: { id } }).catch(() => undefined);
  }
  await app.close();
  await prisma.$disconnect();
}, 60_000);

// ════════════════════════════════════════════════════════════════════════════
// Union scope — read/act across A + B, 403 on unassigned C
// ════════════════════════════════════════════════════════════════════════════
describe('Foreman union scope (primary A + active assignment B)', () => {
  it('dashboard on primary site A is allowed', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/dashboard?siteId=${SITE_A}`,
      headers: auth(foremanToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().filter.siteId).toBe(SITE_A);
  });

  it('dashboard on ASSIGNED site B is allowed (multi-site)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/dashboard?siteId=${SITE_B}`,
      headers: auth(foremanToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().filter.siteId).toBe(SITE_B);
  });

  it('dashboard with NO siteId → union view (filter.siteId null, headcount over A+B)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard',
      headers: auth(foremanToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Multi-site union → not collapsed to a single site.
    expect(body.filter.siteId).toBeNull();
    const headcount = await prisma.worker.count({
      where: { isArchived: false, assignments: { some: { siteId: { in: [SITE_A, SITE_B] } } } },
    });
    expect(body.workers.amountOfWorkers).toBe(headcount);
    // worker-count lists BOTH union sites, never C.
    const wc = await app.inject({
      method: 'GET',
      url: '/api/v1/worker-count',
      headers: auth(foremanToken),
    });
    const ids = (wc.json() as Array<{ siteId: string }>).map((r) => r.siteId).sort();
    expect(ids).toEqual([SITE_A, SITE_B].sort());
  });

  it('CRITICAL: dashboard on UNASSIGNED site C → 403 (no leak)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/dashboard?siteId=${SITE_C}`,
      headers: auth(foremanToken),
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.stringify(res.json())).not.toContain('amountOfWorkers');
  });

  it('can rate a worker on A and on B; CRITICAL 403 on a worker on C', async () => {
    const onA = await app.inject({
      method: 'POST',
      url: `/api/v1/workers/${workerA}/ratings`,
      headers: auth(foremanToken),
      payload: { date: '2026-05-10', score: 4 },
    });
    expect(onA.statusCode).toBe(201);

    const onB = await app.inject({
      method: 'POST',
      url: `/api/v1/workers/${workerB}/ratings`,
      headers: auth(foremanToken),
      payload: { date: '2026-05-10', score: 5 },
    });
    expect(onB.statusCode).toBe(201);

    const onC = await app.inject({
      method: 'POST',
      url: `/api/v1/workers/${workerC}/ratings`,
      headers: auth(foremanToken),
      payload: { date: '2026-05-10', score: 3 },
    });
    expect(onC.statusCode).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Solo (primary only) + empty (fail-closed)
// ════════════════════════════════════════════════════════════════════════════
describe('Solo + empty foreman scope', () => {
  it('solo foreman (primary A, no assignments) still works on A; 403 on B', async () => {
    const a = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard',
      headers: auth(soloToken),
    });
    expect(a.statusCode).toBe(200);
    // Single-site foreman: still collapsed to their one site (zero-backfill preserved).
    expect(a.json().filter.siteId).toBe(SITE_A);

    const b = await app.inject({
      method: 'GET',
      url: `/api/v1/dashboard?siteId=${SITE_B}`,
      headers: auth(soloToken),
    });
    expect(b.statusCode).toBe(403);
  });

  it('CRITICAL: empty-union foreman is fail-closed (403) everywhere', async () => {
    const noSite = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard',
      headers: auth(emptyToken),
    });
    expect(noSite.statusCode).toBe(403);

    const withSite = await app.inject({
      method: 'GET',
      url: `/api/v1/dashboard?siteId=${SITE_A}`,
      headers: auth(emptyToken),
    });
    expect(withSite.statusCode).toBe(403);

    const wc = await app.inject({
      method: 'GET',
      url: '/api/v1/worker-count',
      headers: auth(emptyToken),
    });
    expect(wc.statusCode).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Manager assignment endpoint + unassign fail-closed
// ════════════════════════════════════════════════════════════════════════════
describe('Manager foreman-assignments endpoint', () => {
  it('MANAGER lists the foreman ACTIVE assignments (B)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/foreman-assignments?foremanId=${foremanUserId}`,
      headers: auth(mgrToken),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ siteId: string }>;
    expect(rows.map((r) => r.siteId)).toEqual([SITE_B]);
  });

  it('MANAGER assign is idempotent (reactivate-in-place, no duplicate row)', async () => {
    // Re-assign B (already active) → still one row.
    const again = await app.inject({
      method: 'POST',
      url: '/api/v1/foreman-assignments',
      headers: auth(mgrToken),
      payload: { foremanId: foremanUserId, siteId: SITE_B },
    });
    expect(again.statusCode).toBe(201);
    const count = await prisma.foremanSiteAssignment.count({
      where: { foremanId: foremanUserId, siteId: SITE_B },
    });
    expect(count).toBe(1);
  });

  it('CRITICAL: after UNASSIGN B, the foreman is 403 on B (scope removed, fail-closed)', async () => {
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/foreman-assignments?foremanId=${foremanUserId}&siteId=${SITE_B}`,
      headers: auth(mgrToken),
    });
    expect(del.statusCode).toBe(200);

    const b = await app.inject({
      method: 'GET',
      url: `/api/v1/dashboard?siteId=${SITE_B}`,
      headers: auth(foremanToken),
    });
    expect(b.statusCode).toBe(403);

    // Primary A still works (primary is never removed by unassign).
    const a = await app.inject({
      method: 'GET',
      url: `/api/v1/dashboard?siteId=${SITE_A}`,
      headers: auth(foremanToken),
    });
    expect(a.statusCode).toBe(200);

    // Re-assign B for a clean, deterministic teardown / any later reads.
    const re = await app.inject({
      method: 'POST',
      url: '/api/v1/foreman-assignments',
      headers: auth(mgrToken),
      payload: { foremanId: foremanUserId, siteId: SITE_B },
    });
    expect(re.statusCode).toBe(201);
  });

  it('assign rejects a non-FOREMAN target (400) and a missing site (404)', async () => {
    const notForeman = await app.inject({
      method: 'POST',
      url: '/api/v1/foreman-assignments',
      headers: auth(mgrToken),
      payload: { foremanId: workerUserId, siteId: SITE_A }, // a WORKER user
    });
    expect(notForeman.statusCode).toBe(400);

    const badSite = await app.inject({
      method: 'POST',
      url: '/api/v1/foreman-assignments',
      headers: auth(mgrToken),
      payload: { foremanId: foremanUserId, siteId: `nonexistent-${randomUUID()}` },
    });
    expect(badSite.statusCode).toBe(404);
  });

  it('CRITICAL: WORKER and FOREMAN are refused the assignment endpoint (403, no write)', async () => {
    const workerTry = await app.inject({
      method: 'POST',
      url: '/api/v1/foreman-assignments',
      headers: auth(workerToken),
      payload: { foremanId: foremanUserId, siteId: SITE_C },
    });
    expect(workerTry.statusCode).toBe(403);

    // A foreman must not grant THEMSELVES a new site.
    const foremanTry = await app.inject({
      method: 'POST',
      url: '/api/v1/foreman-assignments',
      headers: auth(foremanToken),
      payload: { foremanId: foremanUserId, siteId: SITE_C },
    });
    expect(foremanTry.statusCode).toBe(403);

    const leaked = await prisma.foremanSiteAssignment.count({
      where: { foremanId: foremanUserId, siteId: SITE_C },
    });
    expect(leaked).toBe(0); // neither forbidden request wrote a row

    const foremanList = await app.inject({
      method: 'GET',
      url: `/api/v1/foreman-assignments?foremanId=${foremanUserId}`,
      headers: auth(foremanToken),
    });
    expect(foremanList.statusCode).toBe(403);
  });
});
