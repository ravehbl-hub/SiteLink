/**
 * GET /foreman-sites — SELF-scoped foreman pickable-site union (LIVE DB / SUPABASE).
 *
 * This is the foreman-facing source for the multi-site picker: a FOREMAN reads THEIR
 * OWN scope union (primarySiteId + active ForemanSiteAssignment rows) resolved to Site
 * NAMES. It reuses lib/scope.resolveSiteScope (the enforcement helper), so it stays
 * consistent with what the foreman may actually act on.
 *
 * Invariants proven here (the security surface Moby's picker depends on):
 *   - A FOREMAN with primary A + active assignment B → [A(isPrimary), B] WITH names.
 *   - A WORKER → 403 (FOREMAN-only self surface).
 *   - A FOREMAN with an EMPTY union → 200 [] (no-site state, NOT 403).
 *
 * SECURITY: the union is built ONLY from req.appUser (server truth) — there is NO
 * client-supplied foremanId on this route, so a foreman can never read another
 * foreman's sites. Self-contained: creates its own sites/users, tears them down.
 * Forged-HS256 auth mirrors the phase05/foreman-multisite pattern.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import type { FastifyInstance } from 'fastify';
import { Role, SiteStatus } from '@sitelink/shared';
import type { PickableSite } from '@sitelink/shared';

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

const SITE_A = `fss-site-A-${randomUUID()}`;
const SITE_B = `fss-site-B-${randomUUID()}`;
const NAME_A = `FSS Alpha ${randomUUID().slice(0, 6)}`;
const NAME_B = `FSS Bravo ${randomUUID().slice(0, 6)}`;

const FOREMAN_AUTH = `fss-for-${randomUUID()}`; // primary A + assignment B → {A, B}
const EMPTY_AUTH = `fss-empty-${randomUUID()}`; // no primary, no assignments → {}
const WORKER_AUTH = `fss-wkr-${randomUUID()}`; // WORKER (guard probe)

let foremanToken: string;
let emptyToken: string;
let workerToken: string;

let foremanUserId: string;
let emptyUserId: string;
let workerUserId: string;

const createdUserIds: string[] = [];

beforeAll(async () => {
  app = await buildApp(loadConfig());
  await app.ready();

  await prisma.site.create({ data: { id: SITE_A, name: NAME_A, status: SiteStatus.ACTIVE } });
  await prisma.site.create({ data: { id: SITE_B, name: NAME_B, status: SiteStatus.ACTIVE } });

  const foreman = await prisma.user.create({
    data: {
      authUserId: FOREMAN_AUTH,
      role: Role.FOREMAN,
      fullName: 'FSS Foreman',
      email: `fss-for-${randomUUID().slice(0, 8)}@sitelink.test`,
      primarySiteId: SITE_A,
    },
  });
  foremanUserId = foreman.id;
  createdUserIds.push(foremanUserId);
  await prisma.foremanSiteAssignment.create({
    data: { foremanId: foremanUserId, siteId: SITE_B },
  });

  const empty = await prisma.user.create({
    data: {
      authUserId: EMPTY_AUTH,
      role: Role.FOREMAN,
      fullName: 'FSS Empty',
      email: `fss-empty-${randomUUID().slice(0, 8)}@sitelink.test`,
    },
  });
  emptyUserId = empty.id;
  createdUserIds.push(emptyUserId);

  const worker = await prisma.user.create({
    data: {
      authUserId: WORKER_AUTH,
      role: Role.WORKER,
      fullName: 'FSS Worker',
      email: `fss-wkr-${randomUUID().slice(0, 8)}@sitelink.test`,
    },
  });
  workerUserId = worker.id;
  createdUserIds.push(workerUserId);

  foremanToken = await signFor(FOREMAN_AUTH);
  emptyToken = await signFor(EMPTY_AUTH);
  workerToken = await signFor(WORKER_AUTH);
}, 60_000);

afterAll(async () => {
  await prisma.foremanSiteAssignment
    .deleteMany({ where: { foremanId: { in: [foremanUserId, emptyUserId] } } })
    .catch(() => undefined);
  for (const id of createdUserIds) {
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of [SITE_A, SITE_B]) {
    await prisma.site.delete({ where: { id } }).catch(() => undefined);
  }
  await app.close();
  await prisma.$disconnect();
}, 60_000);

describe('GET /foreman-sites (self-scoped pickable union)', () => {
  it('FOREMAN with primary A + assignment B → [A(isPrimary), B] WITH names', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/foreman-sites',
      headers: auth(foremanToken),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as PickableSite[];

    // Union is exactly {A, B}, deduped.
    const byId = new Map(rows.map((r) => [r.siteId, r]));
    expect([...byId.keys()].sort()).toEqual([SITE_A, SITE_B].sort());

    const a = byId.get(SITE_A)!;
    expect(a.name).toBe(NAME_A);
    expect(a.isPrimary).toBe(true);
    expect(a.status).toBe(SiteStatus.ACTIVE);

    const b = byId.get(SITE_B)!;
    expect(b.name).toBe(NAME_B);
    expect(b.isPrimary).toBe(false);
    expect(b.status).toBe(SiteStatus.ACTIVE);

    // Exactly one primary.
    expect(rows.filter((r) => r.isPrimary)).toHaveLength(1);
  });

  it('CRITICAL: a WORKER is refused (403 — FOREMAN-only self surface)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/foreman-sites',
      headers: auth(workerToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it('FOREMAN with an EMPTY union → 200 [] (no-site state, not 403)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/foreman-sites',
      headers: auth(emptyToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});
