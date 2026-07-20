/**
 * NEXO-BACK — adversarial supplement to Servio's phase05-foreman-workers suite.
 *
 * Probes two attacks Servio's suite does not cover:
 *   1. LIST unassignedAt leak — `list` scopes with `assignments.some.siteId IN union`
 *      but (unlike attendance/service.ts and assertWorkerInScope) does NOT filter
 *      `unassignedAt: null`. A worker UNASSIGNED from the foreman's site (soft-remove)
 *      whose stale row still bears the union siteId leaks into the foreman's LIST.
 *   2. Mass-assignment / role injection — a malicious foreman POSTs/ PATCHes extra
 *      body keys (role, authUserId, userId, isArchived) trying to escalate the created
 *      identity or hijack a login. Proves Zod strips them and role stays WORKER.
 *
 * Live DB / Supabase (sandbox-disabled). Self-contained fixtures; full teardown.
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
async function signFor(sub: string): Promise<string> {
  return new SignJWT({ aud: 'authenticated', role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(SECRET);
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

let app: FastifyInstance;

const SITE_A = `nx-A-${randomUUID()}`;
const SITE_C = `nx-C-${randomUUID()}`;
const FOREMAN_AUTH = `nx-for-${randomUUID()}`;

let foremanToken: string;
let foremanUserId: string;

let leakWorker: string; // assigned to A then UNASSIGNED; also active on C
let inScopeWorker: string; // active on A

const userIds: string[] = [];
const workerIds: string[] = [];
const authIds: string[] = [];
const appUserIds: string[] = [];

beforeAll(async () => {
  app = await buildApp(loadConfig());
  await app.ready();

  for (const id of [SITE_A, SITE_C]) {
    await prisma.site.create({
      data: { id, name: `NX ${id.slice(0, 10)}`, status: SiteStatus.ACTIVE },
    });
  }

  const foreman = await prisma.user.create({
    data: {
      authUserId: FOREMAN_AUTH,
      companyId: 'cl000000000000000000default',
      role: Role.FOREMAN,
      fullName: 'NX Foreman',
      email: `nx-for-${randomUUID().slice(0, 8)}@sitelink.test`,
      primarySiteId: SITE_A,
    },
  });
  foremanUserId = foreman.id;
  userIds.push(foremanUserId);

  // Leak fixture: a STALE (unassignedAt set) assignment to SITE_A + an ACTIVE
  // assignment to SITE_C (out of union). The worker is genuinely NOT on any of the
  // foreman's active sites, yet the stale SITE_A row bears a union siteId.
  const lw = await prisma.worker.create({
    data: {
      firstName: 'NX',
      lastName: `Leak-${randomUUID().slice(0, 6)}`,
      profession: 'PLUMBER',
      assignments: {
        create: [
          { siteId: SITE_A, unassignedAt: new Date() }, // soft-removed from foreman site
          { siteId: SITE_C }, // active elsewhere (out of union)
        ],
      },
    },
  });
  leakWorker = lw.id;
  workerIds.push(leakWorker);

  const iw = await prisma.worker.create({
    data: {
      firstName: 'NX',
      lastName: `InScope-${randomUUID().slice(0, 6)}`,
      profession: 'PLUMBER',
      assignments: { create: [{ siteId: SITE_A }] },
    },
  });
  inScopeWorker = iw.id;
  workerIds.push(inScopeWorker);

  foremanToken = await signFor(FOREMAN_AUTH);
}, 60_000);

afterAll(async () => {
  for (const wId of [...new Set(workerIds)]) {
    await prisma.siteAssignment.deleteMany({ where: { workerId: wId } }).catch(() => undefined);
    await prisma.worker.update({ where: { id: wId }, data: { userId: null } }).catch(() => undefined);
    await prisma.worker.delete({ where: { id: wId } }).catch(() => undefined);
  }
  for (const aId of [...new Set(authIds)]) {
    await app.supabase.deleteAuthUser(aId).catch(() => undefined);
  }
  for (const uId of [...new Set([...appUserIds, ...userIds])]) {
    await prisma.user.delete({ where: { id: uId } }).catch(() => undefined);
  }
  await prisma.foremanSiteAssignment.deleteMany({ where: { foremanId: foremanUserId } }).catch(() => undefined);
  for (const s of [SITE_A, SITE_C]) {
    await prisma.site.delete({ where: { id: s } }).catch(() => undefined);
  }
  await app.close();
}, 60_000);

describe('NEXO — unassignedAt LIST leak', () => {
  it('VIEW correctly denies the soft-removed worker (assertWorkerInScope filters unassignedAt)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workers/${leakWorker}`,
      headers: auth(foremanToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it('CRITICAL: LIST must NOT leak a worker whose ONLY union-site assignment is unassignedAt-set', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/workers?pageSize=200',
      headers: auth(foremanToken),
    });
    expect(res.statusCode).toBe(200);
    const ids: string[] = res.json().items?.map((w: { id: string }) => w.id)
      ?? res.json().data?.map((w: { id: string }) => w.id)
      ?? [];
    // In-scope worker is present; the soft-removed leakWorker MUST be absent.
    expect(ids).toContain(inScopeWorker);
    expect(ids).not.toContain(leakWorker); // FAILS today → LIST leaks via stale assignment
  });
});

describe('NEXO — mass-assignment / role injection on ADD', () => {
  it('extra body keys (role/authUserId/userId/isArchived) cannot escalate; created User.role stays WORKER', async () => {
    const email = `nx-inject-${randomUUID().slice(0, 8)}@sitelink.test`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workers',
      headers: auth(foremanToken),
      payload: {
        firstName: 'NX',
        lastName: 'Inject',
        profession: 'PLUMBER',
        email,
        password: 'sup3rSecret!!',
        siteIds: [SITE_A],
        // Attacker-injected mass-assignment attempts:
        role: 'ADMIN',
        authUserId: 'attacker-controlled',
        userId: 'attacker-controlled',
        isArchived: true,
        id: 'attacker-chosen-id',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    workerIds.push(body.id);
    // Response must not echo the password.
    expect(JSON.stringify(body)).not.toContain('sup3rSecret');
    expect(body.isArchived).toBe(false);

    // The provisioned login must be role WORKER, not ADMIN.
    const worker = await prisma.worker.findUnique({
      where: { id: body.id },
      select: { userId: true },
    });
    expect(worker?.userId).toBeTruthy();
    appUserIds.push(worker!.userId!);
    const user = await prisma.user.findUnique({
      where: { id: worker!.userId! },
      select: { role: true, authUserId: true },
    });
    if (user?.authUserId) authIds.push(user.authUserId);
    expect(user?.role).toBe(Role.WORKER);
    // authUserId must be the real Supabase id, not the attacker string.
    expect(user?.authUserId).not.toBe('attacker-controlled');
  });
});
