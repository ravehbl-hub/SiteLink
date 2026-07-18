/**
 * ARCHIVED-ONLY VIEW + RESTORE — GET /workers?archivedOnly=true and
 * POST /workers/:id/unarchive (Servio, LIVE DB / SUPABASE).
 *
 * FE archives tab: "when click archive display only what setting archive and add
 * option to restore." This suite proves the back-end contract:
 *
 *   - archive a worker → it leaves the default (active) list, joins the archivedOnly
 *     list, and is NOT in the active list.
 *   - unarchive it → back in the active list, gone from archivedOnly.
 *   - archivedOnly=true returns ONLY archived workers (no active ones).
 *   - archivedOnly respects the FOREMAN site-scope (an out-of-scope archived worker is
 *     never returned) AND the search filter (archivedOnly + search ANDed).
 *   - archive / unarchive stay MANAGER-only: a FOREMAN gets 403 on unarchive.
 *   - unarchive a nonexistent id → 404.
 *
 * Self-contained: creates its OWN sites/users/workers with a UNIQUE tag and asserts
 * ONLY on its own ids (never global counts) so it is immune to the concurrent Savant
 * demo-seed. Auth uses the forged-HS256 pattern (real SUPABASE_JWT_SECRET; sub → a
 * real User.authUserId), same as the search / foreman suites.
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

const TAG = randomUUID().slice(0, 8);

const SITE_IN = `av-in-${randomUUID()}`; // foreman union site
const SITE_OUT = `av-out-${randomUUID()}`; // out-of-scope site

const MGR_AUTH = `av-mgr-${randomUUID()}`;
const FOREMAN_AUTH = `av-for-${randomUUID()}`;

let mgrToken: string;
let foremanToken: string;
let mgrUserId: string;
let foremanUserId: string;

// Unique search token stamped into the two "match" fixtures.
const SEARCH = `Marvin${TAG}`;

let activeWorker: string; // in-scope, active (toggled archived → active through the suite)
let archivedInScope: string; // in-scope, archived from the start, matches SEARCH
let archivedOutScope: string; // OUT-of-scope, archived — must never leak on foreman view
let activeOtherName: string; // in-scope, active, does NOT match SEARCH

const createdWorkerIds: string[] = [];
const createdUserIds: string[] = [];

async function makeSite(id: string): Promise<void> {
  await prisma.site.create({
    data: { id, name: `AV ${id.slice(0, 12)}`, status: SiteStatus.ACTIVE },
  });
}

async function makeWorker(data: {
  firstName: string;
  lastName: string;
  isArchived?: boolean;
  siteIds: string[];
}): Promise<string> {
  const worker = await prisma.worker.create({
    data: {
      firstName: data.firstName,
      lastName: data.lastName,
      profession: 'PLUMBER',
      isArchived: data.isArchived ?? false,
      archivedAt: data.isArchived ? new Date() : null,
      assignments: { create: data.siteIds.map((siteId) => ({ siteId })) },
    },
  });
  createdWorkerIds.push(worker.id);
  return worker.id;
}

beforeAll(async () => {
  app = await buildApp(loadConfig());
  await app.ready();

  await makeSite(SITE_IN);
  await makeSite(SITE_OUT);

  const mgr = await prisma.user.create({
    data: {
      authUserId: MGR_AUTH,
      role: Role.MANAGER,
      fullName: 'AV Manager',
      email: `av-mgr-${randomUUID().slice(0, 8)}@sitelink.test`,
    },
  });
  mgrUserId = mgr.id;
  createdUserIds.push(mgrUserId);

  const foreman = await prisma.user.create({
    data: {
      authUserId: FOREMAN_AUTH,
      role: Role.FOREMAN,
      fullName: 'AV Foreman',
      email: `av-for-${randomUUID().slice(0, 8)}@sitelink.test`,
      primarySiteId: SITE_IN,
    },
  });
  foremanUserId = foreman.id;
  createdUserIds.push(foremanUserId);

  activeWorker = await makeWorker({
    firstName: `Active${TAG}`,
    lastName: `Alpha${TAG}`,
    siteIds: [SITE_IN],
  });
  archivedInScope = await makeWorker({
    firstName: SEARCH,
    lastName: `Archived${TAG}`,
    isArchived: true,
    siteIds: [SITE_IN],
  });
  archivedOutScope = await makeWorker({
    firstName: SEARCH,
    lastName: `OutOfScope${TAG}`,
    isArchived: true,
    siteIds: [SITE_OUT],
  });
  activeOtherName = await makeWorker({
    firstName: `Trillian${TAG}`,
    lastName: `Astra${TAG}`,
    siteIds: [SITE_IN],
  });

  mgrToken = await signFor(MGR_AUTH);
  foremanToken = await signFor(FOREMAN_AUTH);
}, 60_000);

afterAll(async () => {
  for (const wId of createdWorkerIds) {
    await prisma.siteAssignment.deleteMany({ where: { workerId: wId } }).catch(() => undefined);
    await prisma.worker.delete({ where: { id: wId } }).catch(() => undefined);
  }
  for (const id of createdUserIds) {
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of [SITE_IN, SITE_OUT]) {
    await prisma.site.delete({ where: { id } }).catch(() => undefined);
  }
  await app.close();
  await prisma.$disconnect();
}, 60_000);

/** IDs of our own fixtures present in a response (ignores concurrent-seed workers). */
function mineIn(items: Array<{ id: string }>): string[] {
  const mine = new Set(createdWorkerIds);
  return items.filter((w) => mine.has(w.id)).map((w) => w.id);
}

async function listMine(
  token: string,
  qs: string,
): Promise<string[]> {
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/workers?page=1&pageSize=200${qs}`,
    headers: auth(token),
  });
  expect(res.statusCode).toBe(200);
  return mineIn(res.json().items);
}

describe('archive → archivedOnly view → restore (MANAGER)', () => {
  it('archive a worker: leaves the active list, joins archivedOnly', async () => {
    // Pre: activeWorker is in the default (active) list, NOT in archivedOnly.
    expect(await listMine(mgrToken, '')).toContain(activeWorker);
    expect(await listMine(mgrToken, '&archivedOnly=true')).not.toContain(activeWorker);

    const arch = await app.inject({
      method: 'POST',
      url: `/api/v1/workers/${activeWorker}/archive`,
      headers: auth(mgrToken),
    });
    expect(arch.statusCode).toBe(200);
    expect(arch.json().isArchived).toBe(true);

    // Now: gone from active, present in archivedOnly.
    expect(await listMine(mgrToken, '')).not.toContain(activeWorker);
    expect(await listMine(mgrToken, '&archivedOnly=true')).toContain(activeWorker);
  });

  it('unarchive (restore): back in the active list, gone from archivedOnly', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workers/${activeWorker}/unarchive`,
      headers: auth(mgrToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(activeWorker);
    expect(body.isArchived).toBe(false);
    expect(body.archivedAt ?? null).toBeNull();

    expect(await listMine(mgrToken, '')).toContain(activeWorker);
    expect(await listMine(mgrToken, '&archivedOnly=true')).not.toContain(activeWorker);
  });

  it('archivedOnly=true returns ONLY archived workers (no active ones)', async () => {
    const mine = await listMine(mgrToken, '&archivedOnly=true');
    // archivedInScope + archivedOutScope present (manager unscoped, both archived).
    expect(mine).toContain(archivedInScope);
    expect(mine).toContain(archivedOutScope);
    // Active fixtures NOT present.
    expect(mine).not.toContain(activeWorker);
    expect(mine).not.toContain(activeOtherName);
  });
});

describe('archivedOnly respects foreman scope + search', () => {
  it('foreman archivedOnly shows only their-site archived; out-of-scope archived is absent', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/workers?archivedOnly=true&page=1&pageSize=200',
      headers: auth(foremanToken),
    });
    expect(res.statusCode).toBe(200);
    const mine = mineIn(res.json().items);
    expect(mine).toEqual([archivedInScope]);
    expect(mine).not.toContain(archivedOutScope);
    expect(JSON.stringify(res.json())).not.toContain(archivedOutScope);
  });

  it('archivedOnly + search ANDed (manager): only the archived match by name', async () => {
    const mine = await listMine(mgrToken, `&archivedOnly=true&search=${SEARCH}`);
    // Both archived fixtures share SEARCH firstName — manager sees both.
    expect(mine.sort()).toEqual([archivedInScope, archivedOutScope].sort());
    // Narrow by the in-scope archived's unique lastName token.
    const one = await listMine(mgrToken, `&archivedOnly=true&search=Archived${TAG}`);
    expect(one).toEqual([archivedInScope]);
  });

  it('foreman archivedOnly + search stays in-scope (out-of-scope match never leaks)', async () => {
    const mine = await listMine(foremanToken, `&archivedOnly=true&search=${SEARCH}`);
    expect(mine).toEqual([archivedInScope]);
    expect(mine).not.toContain(archivedOutScope);
  });
});

describe('restore is MANAGER-only + 404 guard', () => {
  it('FOREMAN calling unarchive → 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workers/${archivedInScope}/unarchive`,
      headers: auth(foremanToken),
    });
    expect(res.statusCode).toBe(403);
    // Untouched: still archived, still in the foreman's archivedOnly view.
    expect(await listMine(foremanToken, '&archivedOnly=true')).toContain(archivedInScope);
  });

  it('unarchive a nonexistent id → 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workers/${randomUUID()}/unarchive`,
      headers: auth(mgrToken),
    });
    expect(res.statusCode).toBe(404);
  });
});
