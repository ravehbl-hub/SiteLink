/**
 * SERVER-SIDE SEARCH — GET /workers?search= (Servio, LIVE DB / SUPABASE).
 *
 * The workers list is paginated and about to hold ~100 workers, so search MUST be
 * server-side (a DB WHERE clause, not client page filtering). This suite proves:
 *
 *   - ?search=<firstName substring> returns matching workers only; total reflects it.
 *   - search matches lastName and phone too.
 *   - case-insensitive (lowercase query finds a Capitalized name).
 *   - FOREMAN + ?search: only IN-SCOPE matches — a matching worker on an out-of-scope
 *     site is NEVER returned (search does not bypass the foreman site-scope AND).
 *   - empty / whitespace search behaves like NO search (all in scope).
 *   - includeArchived + search interplay: archived excluded unless includeArchived,
 *     AND the search term is still applied.
 *
 * Self-contained: creates its OWN sites/users/workers with UNIQUE, unguessable name
 * tokens and asserts ONLY on its own fixtures (never on global counts) so it is immune
 * to the concurrent Savant demo-seed adding workers. Auth uses the forged-HS256 pattern
 * (real SUPABASE_JWT_SECRET; sub → a real User.authUserId), same as the foreman suites.
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

// A unique token stamped into every fixture worker so we never collide with the
// concurrent demo-seed's workers. Every assertion filters to THESE ids only.
const TAG = randomUUID().slice(0, 8);

const SITE_IN = `ws-in-${randomUUID()}`; // foreman union site
const SITE_OUT = `ws-out-${randomUUID()}`; // out-of-scope site

const MGR_AUTH = `ws-mgr-${randomUUID()}`;
const FOREMAN_AUTH = `ws-for-${randomUUID()}`;

let mgrToken: string;
let foremanToken: string;
let mgrUserId: string;
let foremanUserId: string;

// Distinctive, unique names so `contains` is deterministic against our fixtures only.
const FIRST = `Zaphod${TAG}`; // Capitalized → case-insensitive probe
const LAST = `Beeblebrox${TAG}`;
const PHONE = `0559${TAG}`;

let inMatch: string; // in-scope, matches FIRST/LAST/PHONE
let inOtherName: string; // in-scope, does NOT match FIRST/LAST/PHONE
let inArchived: string; // in-scope, archived, matches FIRST
let outMatch: string; // OUT-of-scope, matches FIRST (must never leak on foreman search)

const createdWorkerIds: string[] = [];
const createdUserIds: string[] = [];

async function makeSite(id: string): Promise<void> {
  await prisma.site.create({
    data: { id, name: `WS ${id.slice(0, 12)}`, status: SiteStatus.ACTIVE },
  });
}

async function makeWorker(data: {
  firstName: string;
  lastName: string;
  phone?: string;
  isArchived?: boolean;
  siteIds: string[];
}): Promise<string> {
  const worker = await prisma.worker.create({
    data: {
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone ?? null,
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
      fullName: 'WS Manager',
      email: `ws-mgr-${randomUUID().slice(0, 8)}@sitelink.test`,
    },
  });
  mgrUserId = mgr.id;
  createdUserIds.push(mgrUserId);

  const foreman = await prisma.user.create({
    data: {
      authUserId: FOREMAN_AUTH,
      role: Role.FOREMAN,
      fullName: 'WS Foreman',
      email: `ws-for-${randomUUID().slice(0, 8)}@sitelink.test`,
      primarySiteId: SITE_IN,
    },
  });
  foremanUserId = foreman.id;
  createdUserIds.push(foremanUserId);

  inMatch = await makeWorker({
    firstName: FIRST,
    lastName: LAST,
    phone: PHONE,
    siteIds: [SITE_IN],
  });
  inOtherName = await makeWorker({
    firstName: `Arthur${TAG}`,
    lastName: `Dent${TAG}`,
    phone: `0501${TAG}`,
    siteIds: [SITE_IN],
  });
  inArchived = await makeWorker({
    firstName: FIRST,
    lastName: `Archived${TAG}`,
    isArchived: true,
    siteIds: [SITE_IN],
  });
  outMatch = await makeWorker({
    firstName: FIRST,
    lastName: `OutOfScope${TAG}`,
    siteIds: [SITE_OUT],
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

describe('GET /workers?search — MANAGER (unscoped) server-side search', () => {
  it('search by firstName substring → matching workers only', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workers?search=${FIRST}&page=1&pageSize=200`,
      headers: auth(mgrToken),
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{ id: string }>;
    const mine = mineIn(items);
    // inMatch + outMatch match FIRST (both non-archived, manager unscoped). inArchived
    // excluded (archived), inOtherName excluded (different name).
    expect(mine.sort()).toEqual([inMatch, outMatch].sort());
    expect(mine).not.toContain(inOtherName);
    expect(mine).not.toContain(inArchived);
  });

  it('search by lastName substring → matching worker', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workers?search=${LAST}&page=1&pageSize=200`,
      headers: auth(mgrToken),
    });
    expect(res.statusCode).toBe(200);
    expect(mineIn(res.json().items)).toEqual([inMatch]);
  });

  it('search by phone substring → matching worker', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workers?search=${PHONE}&page=1&pageSize=200`,
      headers: auth(mgrToken),
    });
    expect(res.statusCode).toBe(200);
    expect(mineIn(res.json().items)).toEqual([inMatch]);
  });

  it('case-insensitive: lowercase query finds a Capitalized name', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workers?search=${FIRST.toLowerCase()}&page=1&pageSize=200`,
      headers: auth(mgrToken),
    });
    expect(res.statusCode).toBe(200);
    const mine = mineIn(res.json().items);
    expect(mine.sort()).toEqual([inMatch, outMatch].sort());
  });

  it('two-word "First Last" refinement matches the combined worker', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workers?search=${FIRST}%20${LAST}&page=1&pageSize=200`,
      headers: auth(mgrToken),
    });
    expect(res.statusCode).toBe(200);
    // outMatch has FIRST but a different lastName → excluded by the two-word AND;
    // inMatch (FIRST + LAST) is the only fixture that matches.
    expect(mineIn(res.json().items)).toEqual([inMatch]);
  });

  it('total reflects the search + pagination works (pageSize=1)', async () => {
    // Narrow to ONE fixture via the unique lastName so total is deterministic (=1).
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workers?search=${LAST}&page=1&pageSize=1`,
      headers: auth(mgrToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.items.length).toBe(1);
    expect(body.items[0].id).toBe(inMatch);
  });

  it('includeArchived + search: archived match appears only WITH includeArchived', async () => {
    const base = `/api/v1/workers?search=${FIRST}&page=1&pageSize=200`;
    const without = await app.inject({ method: 'GET', url: base, headers: auth(mgrToken) });
    expect(mineIn(without.json().items)).not.toContain(inArchived);

    const withArch = await app.inject({
      method: 'GET',
      url: `${base}&includeArchived=true`,
      headers: auth(mgrToken),
    });
    const mine = mineIn(withArch.json().items);
    // Now the archived FIRST match is included; the search term is still applied
    // (inOtherName, which does not match FIRST, stays out).
    expect(mine).toContain(inArchived);
    expect(mine).toContain(inMatch);
    expect(mine).not.toContain(inOtherName);
  });
});

describe('GET /workers?search — FOREMAN search stays IN-SCOPE', () => {
  it('CRITICAL: foreman search matches ONLY in-scope workers — out-of-scope match never leaks', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workers?search=${FIRST}&page=1&pageSize=200`,
      headers: auth(foremanToken),
    });
    expect(res.statusCode).toBe(200);
    const mine = mineIn(res.json().items);
    // inMatch (SITE_IN, matches) present; outMatch (SITE_OUT, matches name) MUST be
    // absent — search AND scope, so it cannot bypass the foreman site filter.
    expect(mine).toEqual([inMatch]);
    expect(mine).not.toContain(outMatch);
    expect(JSON.stringify(res.json())).not.toContain(outMatch);
  });

  it('empty search behaves like no search (all in-scope, non-archived)', async () => {
    const empty = await app.inject({
      method: 'GET',
      url: '/api/v1/workers?search=&page=1&pageSize=200',
      headers: auth(foremanToken),
    });
    const none = await app.inject({
      method: 'GET',
      url: '/api/v1/workers?page=1&pageSize=200',
      headers: auth(foremanToken),
    });
    expect(empty.statusCode).toBe(200);
    expect(mineIn(empty.json().items).sort()).toEqual(mineIn(none.json().items).sort());
    // In-scope, non-archived: inMatch + inOtherName; NOT outMatch, NOT inArchived.
    expect(mineIn(empty.json().items).sort()).toEqual([inMatch, inOtherName].sort());
  });

  it('whitespace-only search behaves like no search', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/workers?search=%20%20%20&page=1&pageSize=200',
      headers: auth(foremanToken),
    });
    expect(res.statusCode).toBe(200);
    expect(mineIn(res.json().items).sort()).toEqual([inMatch, inOtherName].sort());
  });
});
