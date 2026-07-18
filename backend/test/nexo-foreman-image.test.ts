/**
 * PHASE 05 — nexo-back ADVERSARIAL image-scope audit (LIVE DB / SUPABASE).
 *
 * Complements Servio's foreman-worker-image.test.ts by probing the two gaps that suite
 * does NOT cover on the 3 widened image endpoints:
 *
 *   CHECK 4 — SOFT-DELETE LEAK (the exact class of the prior LIST bug): a worker whose
 *     SiteAssignment to the foreman's union site is UNASSIGNED (unassignedAt set) but
 *     who is ACTIVE on another (out-of-union) site. assertWorkerInScope filters
 *     unassignedAt:null, so all 3 image ops MUST 403 via the stale row — never leak.
 *
 *   CHECK 7 — ORDERING / TOCTOU: assertWorkerInScope runs BEFORE any Supabase
 *     createSignedUpload / createSignedRead in ALL three methods. We SPY the Supabase
 *     service; on an out-of-scope 403 the spy must record ZERO calls — a 403 that still
 *     minted a URL would leak an upload/read capability even though the HTTP body hides
 *     it.
 *
 * Self-contained: own sites/users/workers, full teardown. Forged-HS256 auth (real
 * SUPABASE_JWT_SECRET; sub → a real User.authUserId), same pattern as Servio's suite.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
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

const SITE_A = `nfi-site-A-${randomUUID()}`; // foreman union site
const SITE_C = `nfi-site-C-${randomUUID()}`; // out-of-union site
const FOREMAN_AUTH = `nfi-for-${randomUUID()}`;
let foremanToken: string;

// workerSoft: was on SITE_A (union) but that assignment is UNASSIGNED; active on SITE_C.
let workerSoft: string;

const createdUserIds: string[] = [];
const createdWorkerIds: string[] = [];

async function makeSite(id: string): Promise<void> {
  await prisma.site.create({
    data: { id, name: `NFI ${id.slice(0, 12)}`, status: SiteStatus.ACTIVE },
  });
}

beforeAll(async () => {
  app = await buildApp(loadConfig());
  await app.ready();

  await makeSite(SITE_A);
  await makeSite(SITE_C);

  const foreman = await prisma.user.create({
    data: {
      authUserId: FOREMAN_AUTH,
      role: Role.FOREMAN,
      fullName: 'NFI Foreman',
      email: `nfi-for-${randomUUID().slice(0, 8)}@sitelink.test`,
      primarySiteId: SITE_A,
    },
  });
  createdUserIds.push(foreman.id);

  // Soft-delete leak fixture: UNASSIGNED on the union site (unassignedAt set), ACTIVE on
  // the out-of-union site. If assertWorkerInScope ignored unassignedAt it would treat
  // this worker as in-scope via the stale SITE_A row → leak.
  const w = await prisma.worker.create({
    data: {
      firstName: 'NFI',
      lastName: `Soft-${randomUUID().slice(0, 8)}`,
      profession: 'PLUMBER',
      assignments: {
        create: [
          { siteId: SITE_A, unassignedAt: new Date() }, // stale/soft-removed union link
          { siteId: SITE_C }, // active elsewhere
        ],
      },
    },
  });
  workerSoft = w.id;
  createdWorkerIds.push(w.id);

  foremanToken = await signFor(FOREMAN_AUTH);
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  for (const wId of createdWorkerIds) {
    await prisma.siteAssignment.deleteMany({ where: { workerId: wId } }).catch(() => undefined);
    await prisma.worker.delete({ where: { id: wId } }).catch(() => undefined);
  }
  for (const id of createdUserIds) {
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of [SITE_A, SITE_C]) {
    await prisma.site.delete({ where: { id } }).catch(() => undefined);
  }
  await app.close();
  await prisma.$disconnect();
}, 60_000);

// ════════════════════════════════════════════════════════════════════════════
// CHECK 4 — SOFT-DELETE LEAK: stale union assignment must NOT grant image access.
// ════════════════════════════════════════════════════════════════════════════
describe('CHECK 4 — soft-removed union assignment does NOT grant a foreman image access', () => {
  it('CRITICAL: requestImageUpload on the soft-removed worker → 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workers/${workerSoft}/image/upload-url`,
      headers: auth(foremanToken),
      payload: { fileName: 'x.png', mimeType: 'image/png' },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.stringify(res.json())).not.toContain('uploadUrl');
  });

  it('CRITICAL: confirmImage on the soft-removed worker → 403, no FileRef written', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workers/${workerSoft}/image`,
      headers: auth(foremanToken),
      payload: {
        storageKey: `${workerSoft}/image/${randomUUID()}.png`,
        fileName: 'x.png',
        mimeType: 'image/png',
      },
    });
    expect(res.statusCode).toBe(403);
    const after = await prisma.worker.findUnique({
      where: { id: workerSoft },
      select: { imageStorageKey: true },
    });
    expect(after!.imageStorageKey).toBeNull();
  });

  it('CRITICAL: getImageReadUrl on the soft-removed worker → 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workers/${workerSoft}/image/url`,
      headers: auth(foremanToken),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CHECK 7 — ORDERING: on an out-of-scope 403 NO Supabase URL is ever minted.
// ════════════════════════════════════════════════════════════════════════════
describe('CHECK 7 — no signed URL minted before the scope check (ordering/TOCTOU)', () => {
  it('CRITICAL: 403 upload-url makes ZERO createSignedUpload calls', async () => {
    const spy = vi.spyOn(app.supabase, 'createSignedUpload');
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workers/${workerSoft}/image/upload-url`,
      headers: auth(foremanToken),
      payload: { fileName: 'x.png', mimeType: 'image/png' },
    });
    expect(res.statusCode).toBe(403);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('CRITICAL: 403 read-url makes ZERO createSignedRead calls', async () => {
    const spy = vi.spyOn(app.supabase, 'createSignedRead');
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workers/${workerSoft}/image/url`,
      headers: auth(foremanToken),
    });
    expect(res.statusCode).toBe(403);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
