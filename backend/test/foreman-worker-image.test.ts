/**
 * PHASE 05 — FOREMAN WORKER PROFILE IMAGE (SECURITY BOUNDARY, LIVE DB / SUPABASE).
 *
 * Servio widens the 3 worker profile-image endpoints from MANAGER-only to
 * FOREMAN-eligible but STRICTLY site-scoped, mirroring the existing VIEW/EDIT
 * boundary. The SAME guard (lib/scope `assertWorkerInScope`) gates every image op so a
 * FOREMAN can only touch the image of a worker on one of their union sites:
 *
 *   POST /workers/:id/image/upload-url  → requestImageUpload (mint signed upload URL)
 *   POST /workers/:id/image             → confirmImage (persist Worker.image FileRef)
 *   GET  /workers/:id/image/url         → getImageReadUrl (mint signed read URL)
 *
 * Invariants nexo-back will probe:
 *   - FOREMAN image ops for a worker ON their union site → 200/works.
 *   - FOREMAN image ops for a worker on an OUT-of-union site → 403; no URL minted, no
 *     Worker.image FileRef written (assertWorkerInScope short-circuits BEFORE any
 *     Supabase call or DB write).
 *   - EMPTY-union foreman → 403 (fail-closed).
 *   - ADMIN/MANAGER image ops → still work (unscoped) — regression intact.
 *   - docs/salary endpoints STILL 403 for a foreman (NOT widened by this change).
 *   - The confirmImage server-key traversal guard still holds for a FOREMAN (cannot
 *     confirm a key not prefixed with the worker id).
 *
 * Self-contained: creates its OWN sites/users/workers (never seed sites) and tears
 * every row / Supabase object down in afterAll. Auth uses the forged-HS256 pattern
 * (real SUPABASE_JWT_SECRET; sub → a real User.authUserId), same as phase05.
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

// A = foreman union site; C = cross-site probe target (out of union).
const SITE_A = `fwi-site-A-${randomUUID()}`;
const SITE_C = `fwi-site-C-${randomUUID()}`;

const ADMIN_AUTH = `fwi-admin-${randomUUID()}`;
const MGR_AUTH = `fwi-mgr-${randomUUID()}`;
const FOREMAN_AUTH = `fwi-for-${randomUUID()}`; // primary A
const EMPTY_AUTH = `fwi-empty-${randomUUID()}`; // no primary, no assignments

let adminToken: string;
let mgrToken: string;
let foremanToken: string;
let emptyToken: string;

let workerA: string; // on SITE_A (in scope)
let workerC: string; // on SITE_C (out of scope)

const createdUserIds: string[] = [];
const createdWorkerIds: string[] = [];

async function makeSite(id: string): Promise<void> {
  await prisma.site.create({
    data: { id, name: `FWI ${id.slice(0, 12)}`, status: SiteStatus.ACTIVE },
  });
}

async function makeWorkerOnSites(...siteIds: string[]): Promise<string> {
  const worker = await prisma.worker.create({
    data: {
      firstName: 'FWI',
      lastName: `W-${randomUUID().slice(0, 8)}`,
      profession: 'PLUMBER',
      assignments: { create: siteIds.map((siteId) => ({ siteId })) },
    },
  });
  createdWorkerIds.push(worker.id);
  return worker.id;
}

beforeAll(async () => {
  app = await buildApp(loadConfig());
  await app.ready();

  await makeSite(SITE_A);
  await makeSite(SITE_C);

  const admin = await prisma.user.create({
    data: {
      authUserId: ADMIN_AUTH,
      companyId: 'cl000000000000000000default',
      role: Role.ADMIN,
      fullName: 'FWI Admin',
      email: `fwi-admin-${randomUUID().slice(0, 8)}@sitelink.test`,
    },
  });
  createdUserIds.push(admin.id);

  const mgr = await prisma.user.create({
    data: {
      authUserId: MGR_AUTH,
      companyId: 'cl000000000000000000default',
      role: Role.MANAGER,
      fullName: 'FWI Manager',
      email: `fwi-mgr-${randomUUID().slice(0, 8)}@sitelink.test`,
    },
  });
  createdUserIds.push(mgr.id);

  // FOREMAN: primary A → union {A}.
  const foreman = await prisma.user.create({
    data: {
      authUserId: FOREMAN_AUTH,
      companyId: 'cl000000000000000000default',
      role: Role.FOREMAN,
      fullName: 'FWI Foreman',
      email: `fwi-for-${randomUUID().slice(0, 8)}@sitelink.test`,
      primarySiteId: SITE_A,
    },
  });
  createdUserIds.push(foreman.id);

  // EMPTY-union foreman: no primary, no assignments → fail-closed everywhere.
  const empty = await prisma.user.create({
    data: {
      authUserId: EMPTY_AUTH,
      companyId: 'cl000000000000000000default',
      role: Role.FOREMAN,
      fullName: 'FWI Empty',
      email: `fwi-empty-${randomUUID().slice(0, 8)}@sitelink.test`,
    },
  });
  createdUserIds.push(empty.id);

  workerA = await makeWorkerOnSites(SITE_A);
  workerC = await makeWorkerOnSites(SITE_C);

  adminToken = await signFor(ADMIN_AUTH);
  mgrToken = await signFor(MGR_AUTH);
  foremanToken = await signFor(FOREMAN_AUTH);
  emptyToken = await signFor(EMPTY_AUTH);
}, 60_000);

afterAll(async () => {
  // Best-effort purge any stored image objects the confirm/upload flow persisted.
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
  for (const id of [SITE_A, SITE_C]) {
    await prisma.site.delete({ where: { id } }).catch(() => undefined);
  }
  await app.close();
  await prisma.$disconnect();
}, 60_000);

// ════════════════════════════════════════════════════════════════════════════
// FOREMAN — in-scope worker: image ops WORK
// ════════════════════════════════════════════════════════════════════════════
describe('FOREMAN image ops on an IN-SCOPE worker (SITE_A) → work', () => {
  it('requestImageUpload → 200 + signed upload URL for a SERVER-chosen key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workers/${workerA}/image/upload-url`,
      headers: auth(foremanToken),
      payload: { fileName: 'me.png', mimeType: 'image/png' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.uploadUrl).toBeTruthy();
    // Server-generated key: human-browsable `<slug>__<workerId>/image/...` (the
    // `__<id>/` anchor is stable + traversal-safe; the slug is a sanitized name).
    expect(body.storageKey).toMatch(
      new RegExp(`^[a-z0-9-]+__${workerA}/image/[0-9a-f-]+\\.png$`),
    );
    expect(body.storageKey.startsWith('__')).toBe(false);
  });

  it('confirmImage → 200 + persists the Worker.image FileRef', async () => {
    const storageKey = `fwi-worker__${workerA}/image/${randomUUID()}.png`;
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workers/${workerA}/image`,
      headers: auth(foremanToken),
      payload: { storageKey, fileName: 'me.png', mimeType: 'image/png' },
    });
    expect(res.statusCode).toBe(200);
    const row = await prisma.worker.findUnique({
      where: { id: workerA },
      select: { imageStorageKey: true, imageFileName: true, imageMimeType: true },
    });
    expect(row!.imageStorageKey).toBe(storageKey);
    expect(row!.imageFileName).toBe('me.png');
    expect(row!.imageMimeType).toBe('image/png');
  });

  it('getImageReadUrl → NOT 403 (scope passes; 200/404 depending on stored bytes)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workers/${workerA}/image/url`,
      headers: auth(foremanToken),
    });
    // Scope is satisfied — the endpoint must NOT 403. (It may be 200 with a signed URL
    // or 404 if the object bytes were never actually uploaded to storage; either proves
    // the scope gate let the foreman through.)
    expect(res.statusCode).not.toBe(403);
    expect([200, 404]).toContain(res.statusCode);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// FOREMAN — out-of-scope worker (SITE_C): every image op is 403, no side effects
// ════════════════════════════════════════════════════════════════════════════
describe('FOREMAN image ops on an OUT-OF-SCOPE worker (SITE_C) → 403, no side effects', () => {
  it('CRITICAL: requestImageUpload → 403, no URL minted', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workers/${workerC}/image/upload-url`,
      headers: auth(foremanToken),
      payload: { fileName: 'x.png', mimeType: 'image/png' },
    });
    expect(res.statusCode).toBe(403);
    // No signed URL leaked in the body.
    expect(JSON.stringify(res.json())).not.toContain('uploadUrl');
  });

  it('CRITICAL: confirmImage → 403, no Worker.image FileRef written', async () => {
    const before = await prisma.worker.findUnique({
      where: { id: workerC },
      select: { imageStorageKey: true },
    });
    expect(before!.imageStorageKey).toBeNull();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workers/${workerC}/image`,
      headers: auth(foremanToken),
      payload: {
        storageKey: `${workerC}/image/${randomUUID()}.png`,
        fileName: 'x.png',
        mimeType: 'image/png',
      },
    });
    expect(res.statusCode).toBe(403);
    // Persistence never happened — the FileRef is still null.
    const after = await prisma.worker.findUnique({
      where: { id: workerC },
      select: { imageStorageKey: true },
    });
    expect(after!.imageStorageKey).toBeNull();
  });

  it('CRITICAL: getImageReadUrl → 403 (no existence/URL leak)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workers/${workerC}/image/url`,
      headers: auth(foremanToken),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// EMPTY-union foreman → 403 on every image op (fail-closed)
// ════════════════════════════════════════════════════════════════════════════
describe('EMPTY-union foreman → 403 on all image ops', () => {
  it('CRITICAL: requestImageUpload → 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workers/${workerA}/image/upload-url`,
      headers: auth(emptyToken),
      payload: { fileName: 'x.png', mimeType: 'image/png' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('CRITICAL: confirmImage → 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workers/${workerA}/image`,
      headers: auth(emptyToken),
      payload: {
        storageKey: `${workerA}/image/${randomUUID()}.png`,
        fileName: 'x.png',
        mimeType: 'image/png',
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('CRITICAL: getImageReadUrl → 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workers/${workerA}/image/url`,
      headers: auth(emptyToken),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// confirmImage server-key traversal guard still holds for a FOREMAN
// ════════════════════════════════════════════════════════════════════════════
describe('confirmImage traversal guard (FOREMAN, in-scope worker)', () => {
  it('CRITICAL: a key whose `__<id>/` anchor is ANOTHER worker → 400 (rejected)', async () => {
    // In scope (SITE_A), so the scope gate passes — but the key's stable anchor is
    // `__<workerC>/`, not `__<workerA>/`, so the traversal guard must reject it (400).
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workers/${workerA}/image`,
      headers: auth(foremanToken),
      payload: {
        storageKey: `fwi-worker__${workerC}/image/${randomUUID()}.png`, // wrong anchor
        fileName: 'x.png',
        mimeType: 'image/png',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('CRITICAL: a path-traversal key (`..`) → 400 (rejected)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workers/${workerA}/image`,
      headers: auth(foremanToken),
      payload: {
        // Contains this worker's anchor but ALSO `..` — must still reject.
        storageKey: `fwi-worker__${workerA}/image/../../etc/passwd`,
        fileName: 'x.png',
        mimeType: 'image/png',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('CRITICAL: a leading-slash key → 400 (rejected)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workers/${workerA}/image`,
      headers: auth(foremanToken),
      payload: {
        storageKey: `/fwi-worker__${workerA}/image/${randomUUID()}.png`,
        fileName: 'x.png',
        mimeType: 'image/png',
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// New-format key: human-browsable slug from the worker name + non-latin fallback
// ════════════════════════════════════════════════════════════════════════════
describe('new-format storage key — slug from worker name', () => {
  let latinWorker: string;
  let hebrewWorker: string;

  beforeAll(async () => {
    const latin = await prisma.worker.create({
      data: {
        firstName: 'Yossi',
        lastName: 'Cohen',
        profession: 'PLUMBER',
        assignments: { create: [{ siteId: SITE_A }] },
      },
    });
    createdWorkerIds.push(latin.id);
    latinWorker = latin.id;

    const hebrew = await prisma.worker.create({
      data: {
        firstName: 'יוסי',
        lastName: 'כהן',
        profession: 'PLUMBER',
        assignments: { create: [{ siteId: SITE_A }] },
      },
    });
    createdWorkerIds.push(hebrew.id);
    hebrewWorker = hebrew.id;
  });

  it('latin name "Yossi Cohen" → key `yossi-cohen__<id>/image/...`; confirm + read', async () => {
    const up = await app.inject({
      method: 'POST',
      url: `/api/v1/workers/${latinWorker}/image/upload-url`,
      headers: auth(mgrToken),
      payload: { fileName: 'me.png', mimeType: 'image/png' },
    });
    expect(up.statusCode).toBe(200);
    const key: string = up.json().storageKey;
    expect(key).toMatch(
      new RegExp(`^yossi-cohen__${latinWorker}/image/[0-9a-f-]+\\.png$`),
    );

    const conf = await app.inject({
      method: 'POST',
      url: `/api/v1/workers/${latinWorker}/image`,
      headers: auth(mgrToken),
      payload: { storageKey: key, fileName: 'me.png', mimeType: 'image/png' },
    });
    expect(conf.statusCode).toBe(200);
    const row = await prisma.worker.findUnique({
      where: { id: latinWorker },
      select: { imageStorageKey: true },
    });
    expect(row!.imageStorageKey).toBe(key);

    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/workers/${latinWorker}/image/url`,
      headers: auth(mgrToken),
    });
    expect([200, 404]).toContain(read.statusCode);
  });

  it('non-latin (Hebrew) name → slug falls back to `worker` (never empty/unicode/space)', async () => {
    const up = await app.inject({
      method: 'POST',
      url: `/api/v1/workers/${hebrewWorker}/image/upload-url`,
      headers: auth(mgrToken),
      payload: { fileName: 'me.png', mimeType: 'image/png' },
    });
    expect(up.statusCode).toBe(200);
    const key: string = up.json().storageKey;
    expect(key.startsWith(`worker__${hebrewWorker}/image/`)).toBe(true);
    // No raw unicode / spaces / slashes in the slug segment.
    const slug = key.split('__')[0];
    expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(slug).not.toBe('');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Back-compat: an OLD-format key (`<id>/image/...`) still reads
// ════════════════════════════════════════════════════════════════════════════
describe('back-compat — old-format imageStorageKey still readable', () => {
  it('a worker with a legacy `<id>/image/...` key → getImageReadUrl NOT 403 (signs it)', async () => {
    const legacy = await prisma.worker.create({
      data: {
        firstName: 'Legacy',
        lastName: 'Worker',
        profession: 'PLUMBER',
        imageStorageKey: `${MGR_AUTH}/image/${randomUUID()}.jpg`,
        imageFileName: 'old.jpg',
        imageMimeType: 'image/jpeg',
        imageUploadedAt: new Date(),
        assignments: { create: [{ siteId: SITE_A }] },
      },
    });
    createdWorkerIds.push(legacy.id);
    // Fix the key to be `<id>/image/...` (self-referential legacy shape).
    await prisma.worker.update({
      where: { id: legacy.id },
      data: { imageStorageKey: `${legacy.id}/image/legacy.jpg` },
    });

    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/workers/${legacy.id}/image/url`,
      headers: auth(mgrToken),
    });
    // getImageReadUrl signs whatever is stored — old shape is fine; never 403.
    expect(read.statusCode).not.toBe(403);
    expect([200, 404]).toContain(read.statusCode);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// NOT WIDENED — docs/salary still refuse a FOREMAN (403)
// ════════════════════════════════════════════════════════════════════════════
describe('docs/salary remain MANAGER-only for a FOREMAN (not widened)', () => {
  it('CRITICAL: Foreman POST /workers/:id/docs/upload-url → 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workers/${workerA}/docs/upload-url`,
      headers: auth(foremanToken),
      payload: { type: 'ID', fileName: 'id.pdf', mimeType: 'application/pdf' },
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

  it('CRITICAL: Foreman PUT /workers/:id/salary-data → 403', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/workers/${workerA}/salary-data`,
      headers: auth(foremanToken),
      payload: { hourlyWage: 100, rateType: 'HOURLY', currency: 'ILS' },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// REGRESSION — ADMIN/MANAGER image ops still work (unscoped)
// ════════════════════════════════════════════════════════════════════════════
describe('ADMIN/MANAGER image ops still work unscoped (regression)', () => {
  it('MANAGER requestImageUpload on an out-of-any-foreman-union worker (SITE_C) → 200', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workers/${workerC}/image/upload-url`,
      headers: auth(mgrToken),
      payload: { fileName: 'me.png', mimeType: 'image/png' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().uploadUrl).toBeTruthy();
  });

  it('ADMIN confirmImage on the SITE_C worker → 200 + FileRef persisted (unscoped)', async () => {
    const storageKey = `fwi-worker__${workerC}/image/${randomUUID()}.png`;
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workers/${workerC}/image`,
      headers: auth(adminToken),
      payload: { storageKey, fileName: 'me.png', mimeType: 'image/png' },
    });
    expect(res.statusCode).toBe(200);
    const row = await prisma.worker.findUnique({
      where: { id: workerC },
      select: { imageStorageKey: true },
    });
    expect(row!.imageStorageKey).toBe(storageKey);
  });

  it('ADMIN getImageReadUrl on the SITE_C worker → NOT 403 (unscoped)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workers/${workerC}/image/url`,
      headers: auth(adminToken),
    });
    expect(res.statusCode).not.toBe(403);
    expect([200, 404]).toContain(res.statusCode);
  });
});
