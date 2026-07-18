/**
 * WORKERS × PERSONNEL-COMPANY FK BINDING (Servio, LIVE DB / SUPABASE).
 *
 * Closes the contract gap where the workers create/update API bound only the legacy
 * free-text `personnelCompany` string and never accepted/persisted the managed
 * `personnelCompanyId` FK. Proves, end to end against the live pooler:
 *
 *   CREATE with personnelCompanyId → FK persisted + free-text MIRRORED to the company
 *          name; read exposes personnelCompanyId; details exposes personnelCompanyName.
 *   CREATE/UPDATE with a NONEXISTENT or ARCHIVED personnelCompanyId → 400 (never link).
 *   UPDATE clearing personnelCompanyId (null) → FK + mirror both nulled.
 *   Legacy free-text-only create (no personnelCompanyId) still works unchanged.
 *
 * Auth uses the forged-HS256 pattern (real SUPABASE_JWT_SECRET; sub → real
 * User.authUserId), same as the sibling suites. Every row/identity is torn down in
 * afterAll so the run is idempotent. P1001 under a network-restricted sandbox is a
 * FALSE NEGATIVE — re-run with the live-DB harness.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import type { FastifyInstance } from 'fastify';
import { Role } from '@sitelink/shared';

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

const MGR_AUTH = `wpc-mgr-${randomUUID()}`;
let mgrToken: string;

// Teardown trackers.
const createdUserIds: string[] = [];
const createdCompanyIds: string[] = [];
// Workers created via POST /workers dual-write a WORKER login → track for teardown.
const createdWorkerIds: string[] = [];
const createdAppUserIds: string[] = [];
const createdAuthIds: string[] = [];

let activeCompanyId: string;
let activeCompanyName: string;
let archivedCompanyId: string;

/** Track a POST /workers-created worker (Worker row + dual-written login) for teardown. */
async function trackLoginWorker(workerId: string): Promise<void> {
  createdWorkerIds.push(workerId);
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

async function createWorker(payload: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/workers',
    headers: auth(mgrToken),
    payload: {
      firstName: 'WPC',
      lastName: `W-${randomUUID().slice(0, 8)}`,
      profession: 'PLUMBER',
      email: `wpc-${randomUUID().slice(0, 8)}@sitelink.test`,
      password: `Pw-${randomUUID()}`,
      ...payload,
    },
  });
}

beforeAll(async () => {
  app = await buildApp(loadConfig());
  await app.ready();

  const mgr = await prisma.user.create({
    data: {
      authUserId: MGR_AUTH,
      role: Role.MANAGER,
      fullName: 'WPC Manager',
      email: `wpc-mgr-${randomUUID().slice(0, 8)}@sitelink.test`,
    },
  });
  createdUserIds.push(mgr.id);
  mgrToken = await signFor(MGR_AUTH);

  activeCompanyName = `WPC Active ${randomUUID().slice(0, 8)}`;
  const active = await prisma.personnelCompany.create({ data: { name: activeCompanyName } });
  activeCompanyId = active.id;
  createdCompanyIds.push(activeCompanyId);

  const archived = await prisma.personnelCompany.create({
    data: { name: `WPC Archived ${randomUUID().slice(0, 8)}`, isArchived: true },
  });
  archivedCompanyId = archived.id;
  createdCompanyIds.push(archivedCompanyId);
}, 60_000);

afterAll(async () => {
  for (const wId of createdWorkerIds) {
    await prisma.siteAssignment.deleteMany({ where: { workerId: wId } }).catch(() => undefined);
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
  for (const id of createdCompanyIds) {
    await prisma.personnelCompany.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of createdUserIds) {
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  await app.close();
  await prisma.$disconnect();
}, 60_000);

describe('CREATE — personnelCompanyId binding + free-text mirror', () => {
  it('create WITH personnelCompanyId → FK persisted, free-text mirrored to name, read exposes both', async () => {
    const res = await createWorker({ personnelCompanyId: activeCompanyId });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    await trackLoginWorker(body.id);

    // Response (WorkerWithDetails) exposes the FK id + mirrored free-text + resolved name.
    expect(body.personnelCompanyId).toBe(activeCompanyId);
    expect(body.personnelCompany).toBe(activeCompanyName); // mirrored
    expect(body.personnelCompanyName).toBe(activeCompanyName); // resolved from relation

    // DB truth: FK column set, free-text mirrored.
    const row = await prisma.worker.findUnique({
      where: { id: body.id },
      select: { personnelCompanyId: true, personnelCompany: true },
    });
    expect(row!.personnelCompanyId).toBe(activeCompanyId);
    expect(row!.personnelCompany).toBe(activeCompanyName);
  });

  it('legacy free-text-only create (no personnelCompanyId) still works, FK stays null', async () => {
    const res = await createWorker({ personnelCompany: 'Legacy Freetext Co' });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    await trackLoginWorker(body.id);

    expect(body.personnelCompany).toBe('Legacy Freetext Co');
    expect(body.personnelCompanyId).toBeNull();
    expect(body.personnelCompanyName).toBeNull();
  });

  it('create with NONEXISTENT personnelCompanyId → 400 VALIDATION', async () => {
    const res = await createWorker({ personnelCompanyId: `nope-${randomUUID()}` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
    expect(res.json().error.message).toMatch(/personnel company not found/i);
  });

  it('create with ARCHIVED personnelCompanyId → 400 VALIDATION (never link to archived)', async () => {
    const res = await createWorker({ personnelCompanyId: archivedCompanyId });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
  });
});

describe('UPDATE — personnelCompanyId link/clear/validation', () => {
  it('update sets, then clears (null) the FK → mirror follows', async () => {
    // Start unlinked.
    const created = await createWorker({});
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    await trackLoginWorker(id);

    // Link it.
    const linked = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workers/${id}`,
      headers: auth(mgrToken),
      payload: { personnelCompanyId: activeCompanyId },
    });
    expect(linked.statusCode).toBe(200);
    expect(linked.json().personnelCompanyId).toBe(activeCompanyId);
    expect(linked.json().personnelCompany).toBe(activeCompanyName);
    expect(linked.json().personnelCompanyName).toBe(activeCompanyName);

    // Clear it (null) → FK + mirror both nulled.
    const cleared = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workers/${id}`,
      headers: auth(mgrToken),
      payload: { personnelCompanyId: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().personnelCompanyId).toBeNull();
    expect(cleared.json().personnelCompany).toBeNull();
    expect(cleared.json().personnelCompanyName).toBeNull();

    const row = await prisma.worker.findUnique({
      where: { id },
      select: { personnelCompanyId: true, personnelCompany: true },
    });
    expect(row!.personnelCompanyId).toBeNull();
    expect(row!.personnelCompany).toBeNull();
  });

  it('update with NONEXISTENT personnelCompanyId → 400', async () => {
    const created = await createWorker({});
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    await trackLoginWorker(id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workers/${id}`,
      headers: auth(mgrToken),
      payload: { personnelCompanyId: `nope-${randomUUID()}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
  });

  it('update with ARCHIVED personnelCompanyId → 400', async () => {
    const created = await createWorker({});
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    await trackLoginWorker(id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workers/${id}`,
      headers: auth(mgrToken),
      payload: { personnelCompanyId: archivedCompanyId },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
  });
});
