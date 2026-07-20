/**
 * PHASE 05 — FOREMAN WORKER MANAGEMENT (SECURITY BOUNDARY, LIVE DB / SUPABASE).
 *
 * Servio grants a FOREMAN worker management (LIST + VIEW + ADD + EDIT) STRICTLY
 * SCOPED to the foreman's assigned site(s) — everything else on /workers stays
 * MANAGER-only. This adversarial suite proves, end to end against the live pooler,
 * the invariants nexo-back will probe:
 *
 *   LIST  — a Foreman sees ONLY workers on their union sites; ?siteId=<not-in-union>
 *           → 403; ?siteId=<in-union> → that site only; empty-union → 403.
 *   VIEW  — GET a worker on a union site → 200; on an out-of-union site → 403 (never
 *           a 404 that would confirm existence); empty-union → 403.
 *   ADD   — POST with siteIds ⊆ union → 201 + WORKER login provisioned; siteIds with
 *           an out-of-union site → 403; empty/absent siteIds → 400; empty-union → 403;
 *           the created User.role is always WORKER (no role field to escalate).
 *   EDIT  — PATCH a union worker's name → 200; PATCH an out-of-scope worker → 403;
 *           PATCH siteIds=[out-of-union] → 403; CRITICAL: PATCH a shared worker
 *           (siteA∈union + siteC∉union) with siteIds=[siteA] PRESERVES the siteC
 *           assignment (no cross-site deletion); empty siteIds → 400.
 *   MANAGER-ONLY — a Foreman is 403 on archive/remove/salary/docs (unchanged).
 *   REGRESSION — ADMIN/MANAGER keep full unscoped behavior.
 *
 * Self-contained: this file creates its OWN sites/users/workers (never seed sites) so
 * it never perturbs the concurrent seed-reconciliation tests, and tears every row /
 * Supabase identity down in afterAll. Auth uses the forged-HS256 pattern (real
 * SUPABASE_JWT_SECRET; sub → a real User.authUserId), same as foreman-multisite.
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

// Own sites — A + B are the Foreman's union; C is the cross-site probe target.
const SITE_A = `fw-site-A-${randomUUID()}`;
const SITE_B = `fw-site-B-${randomUUID()}`;
const SITE_C = `fw-site-C-${randomUUID()}`;

const ADMIN_AUTH = `fw-admin-${randomUUID()}`;
const MGR_AUTH = `fw-mgr-${randomUUID()}`;
const FOREMAN_AUTH = `fw-for-${randomUUID()}`; // primary A + active assignment B
const EMPTY_AUTH = `fw-empty-${randomUUID()}`; // no primary, no assignments

let adminToken: string;
let mgrToken: string;
let foremanToken: string;
let emptyToken: string;

let adminUserId: string;
let mgrUserId: string;
let foremanUserId: string;
let emptyUserId: string;

// Fixture workers (created directly so we control assignments precisely).
let workerA: string; // on SITE_A (in scope)
let workerC: string; // on SITE_C (out of scope)
let workerShared: string; // on SITE_A + SITE_C (cross-site deletion probe)
// Soft-delete leak probe: SITE_A assignment UNASSIGNED (unassignedAt set) + active on
// SITE_C. Must NOT appear in the foreman's LIST (stale union-site row is not active).
let workerSoftRemoved: string;

// Teardown trackers.
const createdUserIds: string[] = [];
const createdWorkerIds: string[] = [];
const createdAssignmentIds: string[] = [];
// Workers provisioned via POST /workers (dual-write): need Supabase identity teardown.
const createdLoginWorkerIds: string[] = [];
const createdAuthIds: string[] = [];
const createdAppUserIds: string[] = [];

async function makeSite(id: string): Promise<void> {
  await prisma.site.create({
    data: { id, companyId: 'cl000000000000000000default', name: `FW ${id.slice(0, 12)}`, status: SiteStatus.ACTIVE },
  });
}

async function makeWorkerOnSites(...siteIds: string[]): Promise<string> {
  const worker = await prisma.worker.create({
    data: {
      companyId: 'cl000000000000000000default',
      firstName: 'FW',
      lastName: `W-${randomUUID().slice(0, 8)}`,
      profession: 'PLUMBER',
      assignments: { create: siteIds.map((siteId) => ({ siteId })) },
    },
  });
  createdWorkerIds.push(worker.id);
  return worker.id;
}

/** Track a POST /workers-created worker (Worker row + its dual-written login) for teardown. */
async function trackLoginWorker(workerId: string): Promise<void> {
  createdLoginWorkerIds.push(workerId);
  const row = await prisma.worker.findUnique({
    where: { id: workerId },
    select: { userId: true },
  });
  if (row?.userId) {
    createdAppUserIds.push(row.userId);
    const user = await prisma.user.findUnique({
      where: { id: row.userId },
      select: { authUserId: true },
    });
    if (user?.authUserId) createdAuthIds.push(user.authUserId);
  }
}

beforeAll(async () => {
  app = await buildApp(loadConfig());
  await app.ready();

  await makeSite(SITE_A);
  await makeSite(SITE_B);
  await makeSite(SITE_C);

  const admin = await prisma.user.create({
    data: {
      authUserId: ADMIN_AUTH,
      companyId: 'cl000000000000000000default',
      role: Role.ADMIN,
      fullName: 'FW Admin',
      email: `fw-admin-${randomUUID().slice(0, 8)}@sitelink.test`,
    },
  });
  adminUserId = admin.id;
  createdUserIds.push(adminUserId);

  const mgr = await prisma.user.create({
    data: {
      authUserId: MGR_AUTH,
      companyId: 'cl000000000000000000default',
      role: Role.MANAGER,
      fullName: 'FW Manager',
      email: `fw-mgr-${randomUUID().slice(0, 8)}@sitelink.test`,
    },
  });
  mgrUserId = mgr.id;
  createdUserIds.push(mgrUserId);

  // FOREMAN: primary A + active assignment B → union {A, B}.
  const foreman = await prisma.user.create({
    data: {
      authUserId: FOREMAN_AUTH,
      companyId: 'cl000000000000000000default',
      role: Role.FOREMAN,
      fullName: 'FW Foreman',
      email: `fw-for-${randomUUID().slice(0, 8)}@sitelink.test`,
      primarySiteId: SITE_A,
    },
  });
  foremanUserId = foreman.id;
  createdUserIds.push(foremanUserId);
  const asgn = await prisma.foremanSiteAssignment.create({
    data: { foremanId: foremanUserId, siteId: SITE_B },
  });
  createdAssignmentIds.push(asgn.id);

  // EMPTY-union foreman: no primary, no assignments → fail-closed everywhere.
  const empty = await prisma.user.create({
    data: {
      authUserId: EMPTY_AUTH,
      companyId: 'cl000000000000000000default',
      role: Role.FOREMAN,
      fullName: 'FW Empty',
      email: `fw-empty-${randomUUID().slice(0, 8)}@sitelink.test`,
    },
  });
  emptyUserId = empty.id;
  createdUserIds.push(emptyUserId);

  workerA = await makeWorkerOnSites(SITE_A);
  workerC = await makeWorkerOnSites(SITE_C);
  workerShared = await makeWorkerOnSites(SITE_A, SITE_C);

  // workerSoftRemoved: active on SITE_C, but its SITE_A assignment is SOFT-REMOVED
  // (unassignedAt set). The stale SITE_A row must NOT leak this worker into the
  // foreman's (union {A,B}) LIST — LIST must agree with VIEW's 403.
  workerSoftRemoved = await makeWorkerOnSites(SITE_C);
  await prisma.siteAssignment.create({
    data: { workerId: workerSoftRemoved, siteId: SITE_A, unassignedAt: new Date() },
  });

  adminToken = await signFor(ADMIN_AUTH);
  mgrToken = await signFor(MGR_AUTH);
  foremanToken = await signFor(FOREMAN_AUTH);
  emptyToken = await signFor(EMPTY_AUTH);
}, 60_000);

afterAll(async () => {
  const allWorkerIds = [...new Set([...createdWorkerIds, ...createdLoginWorkerIds])];
  for (const wId of allWorkerIds) {
    await prisma.siteAssignment.deleteMany({ where: { workerId: wId } }).catch(() => undefined);
    await prisma.workerSalaryData.deleteMany({ where: { workerId: wId } }).catch(() => undefined);
    // Detach the login user so both delete cleanly.
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
  await prisma.foremanSiteAssignment
    .deleteMany({ where: { foremanId: { in: [foremanUserId, emptyUserId] } } })
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
// LIST — GET /workers (Foreman hard-scoped to union sites)
// ════════════════════════════════════════════════════════════════════════════
describe('LIST GET /workers — Foreman sees ONLY union-site workers', () => {
  it('Foreman (no ?siteId) lists ONLY union workers; CRITICAL never the SITE_C worker', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/workers?page=1&pageSize=200',
      headers: auth(foremanToken),
    });
    expect(res.statusCode).toBe(200);
    const items: Array<{ id: string }> = res.json().items;

    // Every returned worker must be assigned to a union site (A or B).
    const unionWorkerIds = new Set(
      (
        await prisma.siteAssignment.findMany({
          where: { siteId: { in: [SITE_A, SITE_B] } },
          select: { workerId: true },
        })
      ).map((a) => a.workerId),
    );
    for (const w of items) expect(unionWorkerIds.has(w.id)).toBe(true);

    // workerA (SITE_A) present; workerShared present (has SITE_A); workerC ABSENT.
    expect(items.some((w) => w.id === workerA)).toBe(true);
    expect(items.some((w) => w.id === workerShared)).toBe(true);
    expect(items.some((w) => w.id === workerC)).toBe(false);
  });

  it('Foreman ?siteId=SITE_A narrows to that union site only', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workers?siteId=${SITE_A}&page=1&pageSize=200`,
      headers: auth(foremanToken),
    });
    expect(res.statusCode).toBe(200);
    const items: Array<{ id: string }> = res.json().items;
    expect(items.some((w) => w.id === workerA)).toBe(true);
    expect(items.some((w) => w.id === workerC)).toBe(false);
  });

  it('CRITICAL: Foreman ?siteId=SITE_C (not in union) → 403 (no leak)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workers?siteId=${SITE_C}`,
      headers: auth(foremanToken),
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.stringify(res.json())).not.toContain(workerC);
  });

  it('CRITICAL: soft-removed union-site worker (unassignedAt set, active elsewhere) is NOT in LIST', async () => {
    // Regression for the nexo-back LIST leak: workerSoftRemoved has a STALE SITE_A
    // assignment (unassignedAt set) and is active only on out-of-union SITE_C. It must
    // NOT appear — LIST must agree with VIEW (which already 403s this worker).
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/workers?page=1&pageSize=200',
      headers: auth(foremanToken),
    });
    expect(list.statusCode).toBe(200);
    const items: Array<{ id: string }> = list.json().items;
    expect(items.some((w) => w.id === workerSoftRemoved)).toBe(false);

    // Also assert with the explicit ?siteId=SITE_A narrow (same boundary).
    const narrow = await app.inject({
      method: 'GET',
      url: `/api/v1/workers?siteId=${SITE_A}&page=1&pageSize=200`,
      headers: auth(foremanToken),
    });
    expect(narrow.json().items.some((w: { id: string }) => w.id === workerSoftRemoved)).toBe(false);

    // Consistency: VIEW of the same worker is 403 (LIST and VIEW agree).
    const view = await app.inject({
      method: 'GET',
      url: `/api/v1/workers/${workerSoftRemoved}`,
      headers: auth(foremanToken),
    });
    expect(view.statusCode).toBe(403);
  });

  it('CRITICAL: empty-union foreman → 403 on LIST (fail-closed)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/workers',
      headers: auth(emptyToken),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// VIEW — GET /workers/:id (assertWorkerInScope)
// ════════════════════════════════════════════════════════════════════════════
describe('VIEW GET /workers/:id — Foreman scope', () => {
  it('Foreman GET a union-site worker → 200', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workers/${workerA}`,
      headers: auth(foremanToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(workerA);
  });

  it('CRITICAL: VIEW of an in-scope SHARED worker union-filters siteIds (no other-site leak)', async () => {
    // workerShared is on SITE_A (union) + SITE_C (out of union). The foreman is
    // authorized on the worker (SITE_A), but must NOT learn the worker's SITE_C id.
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workers/${workerShared}`,
      headers: auth(foremanToken),
    });
    expect(res.statusCode).toBe(200);
    const siteIds: string[] = res.json().siteIds;
    expect(siteIds).toEqual([SITE_A]); // only the managed site, SITE_C filtered out
    expect(siteIds).not.toContain(SITE_C);

    // ADMIN sees the FULL assignment list for the same worker (unscoped).
    const admin = await app.inject({
      method: 'GET',
      url: `/api/v1/workers/${workerShared}`,
      headers: auth(adminToken),
    });
    expect(admin.json().siteIds.sort()).toEqual([SITE_A, SITE_C].sort());
  });

  it('CRITICAL: Foreman GET an out-of-scope worker (SITE_C) → 403, not 404 (no existence leak)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workers/${workerC}`,
      headers: auth(foremanToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it('CRITICAL: empty-union foreman → 403 on VIEW', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workers/${workerA}`,
      headers: auth(emptyToken),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ADD — POST /workers (scoped create + mandatory WORKER-login dual-write)
// ════════════════════════════════════════════════════════════════════════════
describe('ADD POST /workers — Foreman scoped create', () => {
  it('Foreman POST siteIds=[SITE_A] → 201, on SITE_A, WORKER login provisioned', async () => {
    const email = `fw-created-${randomUUID().slice(0, 8)}@sitelink.test`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workers',
      headers: auth(foremanToken),
      payload: {
        firstName: 'Created',
        lastName: `ByForeman-${randomUUID().slice(0, 8)}`,
        profession: 'PLUMBER',
        siteIds: [SITE_A],
        email,
        password: `Pw-${randomUUID()}`,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    await trackLoginWorker(body.id);

    expect(body.siteIds).toEqual([SITE_A]);
    // WORKER login provisioned + linked (the ONLY safe WORKER→Worker join).
    const row = await prisma.worker.findUnique({
      where: { id: body.id },
      select: { userId: true },
    });
    expect(row!.userId).toBeTruthy();
    const user = await prisma.user.findUnique({ where: { id: row!.userId! } });
    // CRITICAL: role hard-coded WORKER — a foreman cannot escalate the created identity.
    expect(user!.role).toBe(Role.WORKER);
  });

  it('CRITICAL: Foreman POST siteIds=[SITE_C] (out of union) → 403, nothing created', async () => {
    const email = `fw-reject-${randomUUID().slice(0, 8)}@sitelink.test`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workers',
      headers: auth(foremanToken),
      payload: {
        firstName: 'ShouldNot',
        lastName: 'Exist',
        profession: 'PLUMBER',
        siteIds: [SITE_C],
        email,
        password: `Pw-${randomUUID()}`,
      },
    });
    expect(res.statusCode).toBe(403);
    // No worker + no login provisioned for this email.
    const leaked = await prisma.user.count({ where: { email } });
    expect(leaked).toBe(0);
  });

  it('Foreman POST with EMPTY siteIds → 400 (cannot create an unassigned worker)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workers',
      headers: auth(foremanToken),
      payload: {
        firstName: 'No',
        lastName: 'Site',
        profession: 'PLUMBER',
        siteIds: [],
        email: `fw-empty-sites-${randomUUID().slice(0, 8)}@sitelink.test`,
        password: `Pw-${randomUUID()}`,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('Foreman POST with ABSENT siteIds → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workers',
      headers: auth(foremanToken),
      payload: {
        firstName: 'No',
        lastName: 'Site',
        profession: 'PLUMBER',
        email: `fw-absent-sites-${randomUUID().slice(0, 8)}@sitelink.test`,
        password: `Pw-${randomUUID()}`,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('CRITICAL: empty-union foreman → 403 on ADD', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workers',
      headers: auth(emptyToken),
      payload: {
        firstName: 'No',
        lastName: 'Union',
        profession: 'PLUMBER',
        siteIds: [SITE_A],
        email: `fw-emptyunion-${randomUUID().slice(0, 8)}@sitelink.test`,
        password: `Pw-${randomUUID()}`,
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('Foreman POST WITHOUT password → 400 (password now required; Zod → 400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workers',
      headers: auth(foremanToken),
      payload: {
        firstName: 'No',
        lastName: 'Password',
        profession: 'PLUMBER',
        siteIds: [SITE_A],
        email: `fw-nopw-${randomUUID().slice(0, 8)}@sitelink.test`,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('Foreman POST with SHORT password (<8) → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workers',
      headers: auth(foremanToken),
      payload: {
        firstName: 'Short',
        lastName: 'Pw',
        profession: 'PLUMBER',
        siteIds: [SITE_A],
        email: `fw-shortpw-${randomUUID().slice(0, 8)}@sitelink.test`,
        password: 'short',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('CRITICAL: password is NEVER echoed in the create response', async () => {
    const email = `fw-nopwleak-${randomUUID().slice(0, 8)}@sitelink.test`;
    const password = `Pw-${randomUUID()}`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workers',
      headers: auth(foremanToken),
      payload: {
        firstName: 'NoLeak',
        lastName: `Pw-${randomUUID().slice(0, 8)}`,
        profession: 'PLUMBER',
        siteIds: [SITE_A],
        email,
        password,
      },
    });
    expect(res.statusCode).toBe(201);
    await trackLoginWorker(res.json().id);
    // The plaintext password must not appear anywhere in the response body.
    expect(res.body).not.toContain(password);
    expect(JSON.stringify(res.json())).not.toMatch(/password/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// EDIT — PATCH /workers/:id (scope + scoped assignment setter)
// ════════════════════════════════════════════════════════════════════════════
describe('EDIT PATCH /workers/:id — Foreman scoped edit', () => {
  it('Foreman PATCH a union-worker name → 200', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workers/${workerA}`,
      headers: auth(foremanToken),
      payload: { firstName: 'Renamed' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().firstName).toBe('Renamed');
  });

  it('CRITICAL: Foreman PATCH an out-of-scope worker (SITE_C) → 403, no mutation', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workers/${workerC}`,
      headers: auth(foremanToken),
      payload: { firstName: 'HACKED' },
    });
    expect(res.statusCode).toBe(403);
    const row = await prisma.worker.findUnique({ where: { id: workerC } });
    expect(row!.firstName).not.toBe('HACKED');
  });

  it('CRITICAL: Foreman PATCH siteIds=[SITE_C] (out of union) → 403', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workers/${workerA}`,
      headers: auth(foremanToken),
      payload: { siteIds: [SITE_C] },
    });
    expect(res.statusCode).toBe(403);
    // workerA still on SITE_A, never moved to SITE_C.
    const asgns = await prisma.siteAssignment.findMany({ where: { workerId: workerA } });
    expect(asgns.map((a) => a.siteId)).toContain(SITE_A);
    expect(asgns.map((a) => a.siteId)).not.toContain(SITE_C);
  });

  it('CRITICAL: Foreman PATCH shared worker (A+C) siteIds=[A] PRESERVES the out-of-union C assignment', async () => {
    // Precondition: workerShared on SITE_A (union) + SITE_C (out of union).
    const before = await prisma.siteAssignment.findMany({ where: { workerId: workerShared } });
    expect(before.map((a) => a.siteId).sort()).toEqual([SITE_A, SITE_C].sort());

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workers/${workerShared}`,
      headers: auth(foremanToken),
      payload: { siteIds: [SITE_A] }, // foreman drops nothing in-union; C is out of reach
    });
    expect(res.statusCode).toBe(200);

    const after = await prisma.siteAssignment.findMany({ where: { workerId: workerShared } });
    // The out-of-union SITE_C assignment MUST survive — no cross-site deletion.
    expect(after.map((a) => a.siteId).sort()).toEqual([SITE_A, SITE_C].sort());
  });

  it('Foreman PATCH shared worker adds SITE_B (in union) while preserving SITE_C', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workers/${workerShared}`,
      headers: auth(foremanToken),
      payload: { siteIds: [SITE_A, SITE_B] },
    });
    expect(res.statusCode).toBe(200);
    const after = await prisma.siteAssignment.findMany({ where: { workerId: workerShared } });
    expect(after.map((a) => a.siteId).sort()).toEqual([SITE_A, SITE_B, SITE_C].sort());
  });

  it('Foreman PATCH with EMPTY siteIds → 400 (cannot orphan a worker)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workers/${workerA}`,
      headers: auth(foremanToken),
      payload: { siteIds: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('CRITICAL: empty-union foreman → 403 on EDIT', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workers/${workerA}`,
      headers: auth(emptyToken),
      payload: { firstName: 'X' },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// MANAGER-ONLY surfaces stay closed to a FOREMAN (archive/remove/salary/docs)
// ════════════════════════════════════════════════════════════════════════════
describe('MANAGER-only worker surfaces refuse a FOREMAN (403)', () => {
  it('CRITICAL: Foreman POST /workers/:id/archive → 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workers/${workerA}/archive`,
      headers: auth(foremanToken),
    });
    expect(res.statusCode).toBe(403);
    const row = await prisma.worker.findUnique({ where: { id: workerA } });
    expect(row!.isArchived).toBe(false); // untouched
  });

  it('CRITICAL: Foreman DELETE /workers/:id → 403, worker survives', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/workers/${workerA}`,
      headers: auth(foremanToken),
    });
    expect(res.statusCode).toBe(403);
    expect(await prisma.worker.findUnique({ where: { id: workerA } })).not.toBeNull();
  });

  it('CRITICAL: Foreman PUT /workers/:id/salary-data → 403', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/workers/${workerA}/salary-data`,
      headers: auth(foremanToken),
      payload: { hourlyWage: 100, rateType: 'HOURLY', currency: 'ILS' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('CRITICAL: Foreman GET /workers/:id/docs → 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workers/${workerA}/docs`,
      headers: auth(foremanToken),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// REGRESSION — ADMIN/MANAGER keep full unscoped behavior
// ════════════════════════════════════════════════════════════════════════════
describe('ADMIN/MANAGER regression — unscoped behavior intact', () => {
  it('MANAGER lists sees the out-of-any-foreman-union SITE_C worker', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workers?siteId=${SITE_C}&page=1&pageSize=200`,
      headers: auth(mgrToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.some((w: { id: string }) => w.id === workerC)).toBe(true);
  });

  it('MANAGER GET a SITE_C worker → 200 (unscoped)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workers/${workerC}`,
      headers: auth(mgrToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(workerC);
  });

  it('MANAGER create WITHOUT siteIds → 201 (siteIds optional for manager)', async () => {
    const email = `fw-mgr-created-${randomUUID().slice(0, 8)}@sitelink.test`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workers',
      headers: auth(mgrToken),
      payload: {
        firstName: 'Mgr',
        lastName: `Created-${randomUUID().slice(0, 8)}`,
        profession: 'PLUMBER',
        email,
        password: `Pw-${randomUUID()}`,
      },
    });
    expect(res.statusCode).toBe(201);
    await trackLoginWorker(res.json().id);
    expect(res.json().siteIds).toEqual([]);
  });

  it('MANAGER create WITHOUT password → 400 (required for all callers; Zod → 400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workers',
      headers: auth(mgrToken),
      payload: {
        firstName: 'Mgr',
        lastName: 'NoPw',
        profession: 'PLUMBER',
        email: `fw-mgr-nopw-${randomUUID().slice(0, 8)}@sitelink.test`,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('ADMIN full setAssignments replaces across ALL sites (out-of-any-union too)', async () => {
    // Admin edits workerShared (A+B+C after the foreman edits) down to just [SITE_B].
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workers/${workerShared}`,
      headers: auth(adminToken),
      payload: { siteIds: [SITE_B] },
    });
    expect(res.statusCode).toBe(200);
    const after = await prisma.siteAssignment.findMany({ where: { workerId: workerShared } });
    // Full replace: A and C removed, only B remains.
    expect(after.map((a) => a.siteId)).toEqual([SITE_B]);
  });
});
