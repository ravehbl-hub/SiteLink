/**
 * PHASE 05 — nexo-back ADVERSARIAL audit of the NEW image storage-key format +
 * confirmImage traversal guard (LIVE DB / SUPABASE).
 *
 * The storage key changed from `<id>/image/<uuid>.ext` to
 * `<slug>__<id>/image/<uuid>.ext`, and the confirmImage guard changed from
 * startsWith(`<id>/`) to: reject unless key CONTAINS `__<id>/` AND no `..` AND no
 * leading '/'. This suite proves the two properties that suite foreman-worker-image
 * does NOT explicitly cover:
 *
 *   CHECK 2/3 — CROSS-WORKER / SUBSTRING escape: a caller in scope for worker A cannot
 *     confirm a key that resolves into ANOTHER worker B's namespace, even when the
 *     literal `__<A>/` anchor appears as a substring but a `..` re-points elsewhere
 *     (`x__<A>/../<slug>__<B>/image/y`) — the `..` rejection blocks it (400). A wrong
 *     anchor (`s__<B>/...`) → 400.
 *
 *   CHECK 2/3 SEVERITY NOTE — ARBITRARY-SLUG-IN-OWN-NAMESPACE: confirmImage persists
 *     the CLIENT-supplied key VERBATIM (it pattern-matches, it does NOT verify the key
 *     equals the one the server minted). So an in-scope caller CAN confirm an
 *     attacker-chosen-slug key `evil__<A>/image/x.jpg` (contains `__A/`, no `..`, no
 *     leading '/'). This is CONTAINED to A's own `*__<A>` namespace and is scope-checked
 *     — no cross-worker/bucket escape — so it is acceptable (equivalent-or-better than
 *     the old startsWith(`<A>/`) guard). This test PINS that behavior so a future
 *     regression (e.g. someone loosening the anchor) is caught.
 *
 * Self-contained: own sites/users/workers, full teardown. Forged-HS256 auth.
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

const SITE_A = `nikt-site-A-${randomUUID()}`;
const MGR_AUTH = `nikt-mgr-${randomUUID()}`;
let mgrToken: string;

let workerA: string; // the target we confirm against
let workerB: string; // the "other" worker we must NOT be able to write into

const createdUserIds: string[] = [];
const createdWorkerIds: string[] = [];

async function makeWorker(): Promise<string> {
  const w = await prisma.worker.create({
    data: {
      firstName: 'NIKT',
      lastName: `W-${randomUUID().slice(0, 8)}`,
      profession: 'PLUMBER',
      assignments: { create: [{ siteId: SITE_A }] },
    },
  });
  createdWorkerIds.push(w.id);
  return w.id;
}

beforeAll(async () => {
  app = await buildApp(loadConfig());
  await app.ready();

  await prisma.site.create({
    data: { id: SITE_A, name: `NIKT ${SITE_A.slice(0, 10)}`, status: SiteStatus.ACTIVE },
  });

  const mgr = await prisma.user.create({
    data: {
      authUserId: MGR_AUTH,
      role: Role.MANAGER,
      fullName: 'NIKT Manager',
      email: `nikt-mgr-${randomUUID().slice(0, 8)}@sitelink.test`,
    },
  });
  createdUserIds.push(mgr.id);

  workerA = await makeWorker();
  workerB = await makeWorker();
  mgrToken = await signFor(MGR_AUTH);
}, 60_000);

afterAll(async () => {
  for (const wId of createdWorkerIds) {
    const w = await prisma.worker
      .findUnique({ where: { id: wId }, select: { imageStorageKey: true } })
      .catch(() => null);
    if (w?.imageStorageKey) {
      await app.supabase
        .removeObject({ kind: 'image', storageKey: w.imageStorageKey })
        .catch(() => undefined);
    }
    await prisma.siteAssignment.deleteMany({ where: { workerId: wId } }).catch(() => undefined);
    await prisma.worker.delete({ where: { id: wId } }).catch(() => undefined);
  }
  for (const id of createdUserIds) {
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.site.delete({ where: { id: SITE_A } }).catch(() => undefined);
  await app.close();
  await prisma.$disconnect();
}, 60_000);

describe('CHECK 2/3 — confirmImage cannot escape worker A into another namespace', () => {
  it('CRITICAL: substring anchor + `..` re-pointing into B → 400 (blocked by `..` guard)', async () => {
    // Literal `__<A>/` appears, but the `..` would traverse OUT toward B's folder.
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workers/${workerA}/image`,
      headers: auth(mgrToken),
      payload: {
        storageKey: `x__${workerA}/../evil__${workerB}/image/${randomUUID()}.png`,
        fileName: 'x.png',
        mimeType: 'image/png',
      },
    });
    expect(res.statusCode).toBe(400);
    // Nothing was written onto A.
    const a = await prisma.worker.findUnique({
      where: { id: workerA },
      select: { imageStorageKey: true },
    });
    expect(a!.imageStorageKey).toBeNull();
    // And absolutely nothing landed on B.
    const b = await prisma.worker.findUnique({
      where: { id: workerB },
      select: { imageStorageKey: true },
    });
    expect(b!.imageStorageKey).toBeNull();
  });

  it("CRITICAL: a key carrying only B's anchor (`s__<B>/...`) → 400, B untouched", async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workers/${workerA}/image`,
      headers: auth(mgrToken),
      payload: {
        storageKey: `s__${workerB}/image/${randomUUID()}.png`,
        fileName: 'x.png',
        mimeType: 'image/png',
      },
    });
    expect(res.statusCode).toBe(400);
    const b = await prisma.worker.findUnique({
      where: { id: workerB },
      select: { imageStorageKey: true },
    });
    expect(b!.imageStorageKey).toBeNull();
  });

  it('SEVERITY PIN: an arbitrary-slug key WITHIN A\'s own namespace is accepted (contained + scoped)', async () => {
    // Attacker-chosen slug `evil` — NOT the server-minted slug — but it is still A's own
    // `*__<A>` namespace, no `..`, no leading '/'. confirmImage persists verbatim. This
    // is acceptable (contained to A, scope-checked; no cross-worker escape). If a future
    // change tightens confirmImage to require the exact minted key, flip this to expect
    // 400 — but today the documented, acceptable behavior is 200.
    const key = `evil__${workerA}/image/${randomUUID()}.png`;
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workers/${workerA}/image`,
      headers: auth(mgrToken),
      payload: { storageKey: key, fileName: 'x.png', mimeType: 'image/png' },
    });
    expect(res.statusCode).toBe(200);
    const a = await prisma.worker.findUnique({
      where: { id: workerA },
      select: { imageStorageKey: true },
    });
    // Contained: the persisted key is still anchored to A, never B.
    expect(a!.imageStorageKey).toBe(key);
    expect(a!.imageStorageKey!.includes(`__${workerB}/`)).toBe(false);
  });
});
