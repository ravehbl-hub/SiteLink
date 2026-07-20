/**
 * NEXO — ADVERSARIAL multi-tenancy Phase-1 audit (Users surface + companies + scope).
 *
 * Complements Servio's multitenancy-phase1.test.ts with EXTRA adversarial probes the
 * catastrophic set demands:
 *   - WRITE-IDOR byte-unchanged proof across update/lockout/delete (re-read full row).
 *   - CREATE cross-tenant injection via body companyId, ?companyId, AND both together.
 *   - Role×company compose: MANAGER-A cannot reach a company-B ADMIN/PARTNER by id.
 *   - ?companyId=B widening attempt with a role filter that matches only B rows.
 *   - update cannot smuggle a companyId (schema strips it) — company stays put.
 *   - No cross-tenant existence ORACLE difference: company-B id vs nonexistent id.
 *   - Identity plumbing: a forged companyId claim in the JWT is ignored (server row wins).
 *   - Fail-closed scope for a non-admin with empty companyId.
 *   - Backfill integrity: 0 NULL companyId, Default Company exists, every user → real Co.
 *
 * Forged HS256 tokens signed with the REAL SUPABASE_JWT_SECRET; sub → a real
 * User.authUserId. Role + companyId ALWAYS resolve from the app User row, never the token.
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
const DEFAULT_COMPANY_ID = 'cl000000000000000000default';

async function signFor(authUserId: string, extraClaims: Record<string, unknown> = {}): Promise<string> {
  return new SignJWT({ aud: 'authenticated', role: 'authenticated', ...extraClaims })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(authUserId)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(SECRET);
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const uniq = () => randomUUID().slice(0, 8);

let app: FastifyInstance;
let companyAId: string;
let companyBId: string;

const ADMIN_AUTH = `nx-admin-${randomUUID()}`;
const MGR_A_AUTH = `nx-mgrA-${randomUUID()}`;

let adminToken: string;
let mgrAToken: string;
let mgrAForgedCompanyToken: string;

let foremanAId: string;
let workerBId: string;
let adminBId: string; // an ADMIN row on company B — MANAGER-A must never touch it.
let partnerBId: string; // a PARTNER row on company B — outside MANAGER manageable set.

const createdAppUserIds: string[] = [];
const createdAuthIds: string[] = [];

async function seedUser(email: string, role: Role, companyId: string, authUserId: string): Promise<string> {
  const row = await prisma.user.upsert({
    where: { email },
    update: { role, companyId, isLockedOut: false, authUserId },
    create: { authUserId, companyId, role, fullName: email.split('@')[0], email },
  });
  createdAppUserIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  app = await buildApp(loadConfig());
  await app.ready();

  const compA = await prisma.company.create({ data: { name: `NX Company A ${uniq()}` } });
  const compB = await prisma.company.create({ data: { name: `NX Company B ${uniq()}` } });
  companyAId = compA.id;
  companyBId = compB.id;

  await seedUser('nx-admin@sitelink.test', Role.ADMIN, DEFAULT_COMPANY_ID, ADMIN_AUTH);
  await seedUser('nx-managerA@sitelink.test', Role.MANAGER, companyAId, MGR_A_AUTH);
  foremanAId = await seedUser('nx-foremanA@sitelink.test', Role.FOREMAN, companyAId, `nx-forA-${uniq()}`);
  workerBId = await seedUser('nx-workerB@sitelink.test', Role.WORKER, companyBId, `nx-wrkB-${uniq()}`);
  adminBId = await seedUser('nx-adminB@sitelink.test', Role.ADMIN, companyBId, `nx-admB-${uniq()}`);
  partnerBId = await seedUser('nx-partnerB@sitelink.test', Role.PARTNER, companyBId, `nx-parB-${uniq()}`);

  adminToken = await signFor(ADMIN_AUTH);
  mgrAToken = await signFor(MGR_A_AUTH);
  // Forge a companyId=B claim in the JWT — must be ignored (server uses DB row = A).
  mgrAForgedCompanyToken = await signFor(MGR_A_AUTH, { companyId: companyBId, company_id: companyBId });
});

afterAll(async () => {
  for (const authId of createdAuthIds) await app.supabase.deleteAuthUser(authId).catch(() => undefined);
  for (const id of createdAppUserIds) await prisma.user.delete({ where: { id } }).catch(() => undefined);
  await prisma.company.delete({ where: { id: companyAId } }).catch(() => undefined);
  await prisma.company.delete({ where: { id: companyBId } }).catch(() => undefined);
  await app.close();
});

const get = (u: string, t: string) => app.inject({ method: 'GET', url: `/api/v1${u}`, headers: auth(t) });
const post = (u: string, t: string, p?: unknown) => app.inject({ method: 'POST', url: `/api/v1${u}`, headers: auth(t), payload: p });
const patch = (u: string, t: string, p?: unknown) => app.inject({ method: 'PATCH', url: `/api/v1${u}`, headers: auth(t), payload: p });
const del = (u: string, t: string) => app.inject({ method: 'DELETE', url: `/api/v1${u}`, headers: auth(t) });

describe('NEXO adversarial multi-tenancy P1', () => {
  // ── LIST widening attempts ────────────────────────────────────────────────
  it('MANAGER-A ?companyId=B&role=WORKER (targeting a B-only worker) → still ONLY company A', async () => {
    const res = await get(`/users?pageSize=200&companyId=${companyBId}&role=WORKER`, mgrAToken);
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{ id: string; companyId: string }>;
    expect(items.every((u) => u.companyId === companyAId)).toBe(true);
    expect(items.map((u) => u.id)).not.toContain(workerBId);
  });

  it('MANAGER-A cannot page to any company-B user across a huge pageSize', async () => {
    const res = await get('/users?pageSize=200', mgrAToken);
    const companies = (res.json().items as Array<{ companyId: string }>).map((u) => u.companyId);
    expect(companies.every((c) => c === companyAId)).toBe(true);
  });

  it('MANAGER-A ?role=ADMIN / ?role=PARTNER → empty (never a B ADMIN/PARTNER row)', async () => {
    for (const r of ['ADMIN', 'PARTNER']) {
      const res = await get(`/users?pageSize=200&companyId=${companyBId}&role=${r}`, mgrAToken);
      expect(res.statusCode).toBe(200);
      expect(res.json().items).toHaveLength(0);
    }
  });

  // ── GET IDOR + oracle consistency ──────────────────────────────────────────
  it('MANAGER-A GET company-B worker vs nonexistent id → SAME 404 (no oracle)', async () => {
    const b = await get(`/users/${workerBId}`, mgrAToken);
    const nonexist = await get(`/users/does-not-exist-${uniq()}`, mgrAToken);
    expect(b.statusCode).toBe(404);
    expect(nonexist.statusCode).toBe(404);
    expect(b.body).not.toContain('nx-workerB');
  });

  it('MANAGER-A GET company-B ADMIN / PARTNER by id → 404 (tenant filter first)', async () => {
    for (const id of [adminBId, partnerBId]) {
      const res = await get(`/users/${id}`, mgrAToken);
      expect(res.statusCode).toBe(404);
    }
  });

  // ── WRITE-IDOR (catastrophic): byte-unchanged proof ─────────────────────────
  it('MANAGER-A update/lockout/delete company-B worker → denied + row BYTE-UNCHANGED', async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: workerBId } });

    const u = await patch(`/users/${workerBId}`, mgrAToken, { fullName: 'HACKED', email: 'hijack@x.test', role: Role.ADMIN, isLockedOut: true });
    expect(u.statusCode).toBe(404);

    const l = await post(`/users/${workerBId}/lockout`, mgrAToken, { isLockedOut: true });
    expect(l.statusCode).toBe(404);

    const d = await del(`/users/${workerBId}`, mgrAToken);
    expect(d.statusCode).toBe(404);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: workerBId } });
    // Every field the attacker tried to mutate is unchanged.
    expect(after.fullName).toBe(before.fullName);
    expect(after.email).toBe(before.email);
    expect(after.role).toBe(before.role);
    expect(after.isLockedOut).toBe(before.isLockedOut);
    expect(after.companyId).toBe(companyBId);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it('MANAGER-A update/delete company-B ADMIN (role-hidden AND cross-tenant) → 404, unchanged', async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: adminBId } });
    const u = await patch(`/users/${adminBId}`, mgrAToken, { fullName: 'HACKED-ADMIN' });
    expect(u.statusCode).toBe(404);
    const d = await del(`/users/${adminBId}`, mgrAToken);
    expect(d.statusCode).toBe(404);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: adminBId } });
    expect(after.fullName).toBe(before.fullName);
    expect(after.role).toBe(Role.ADMIN);
  });

  // ── CREATE cross-tenant injection: every request-shaping vector ─────────────
  it('MANAGER-A create with body+query+header companyId=B → stamped A', async () => {
    const email = `nx-inj-${uniq()}@sitelink.test`;
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/users?companyId=${companyBId}`,
      headers: { ...auth(mgrAToken), 'x-company-id': companyBId },
      payload: { role: Role.FOREMAN, fullName: 'Inj', email, password: `Pw-${randomUUID()}`, companyId: companyBId },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json();
    createdAppUserIds.push(created.id);
    const row = await prisma.user.findUnique({ where: { id: created.id } });
    if (row) createdAuthIds.push(row.authUserId);
    expect(created.companyId).toBe(companyAId);
    expect(created.companyId).not.toBe(companyBId);
    expect(row!.companyId).toBe(companyAId);
  });

  it('MANAGER-A create ADMIN/PARTNER (privilege escalation) → 403, no row', async () => {
    for (const r of [Role.ADMIN, Role.PARTNER]) {
      const res = await post('/users', mgrAToken, { role: r, fullName: 'Esc', email: `nx-esc-${uniq()}@sitelink.test`, password: `Pw-${randomUUID()}` });
      expect(res.statusCode).toBe(403);
    }
  });

  // ── Identity plumbing: forged JWT companyId claim ignored ───────────────────
  it('MANAGER-A with a forged companyId=B JWT claim → list still ONLY company A', async () => {
    const res = await get('/users?pageSize=200', mgrAForgedCompanyToken);
    expect(res.statusCode).toBe(200);
    const companies = (res.json().items as Array<{ companyId: string }>).map((u) => u.companyId);
    expect(companies.every((c) => c === companyAId)).toBe(true);
  });

  it('MANAGER-A forged-claim token create → stamped A (server row wins, not JWT claim)', async () => {
    const email = `nx-forged-${uniq()}@sitelink.test`;
    const res = await post('/users', mgrAForgedCompanyToken, { role: Role.WORKER, fullName: 'Forged', email, password: `Pw-${randomUUID()}` });
    expect(res.statusCode).toBe(201);
    const created = res.json();
    createdAppUserIds.push(created.id);
    const row = await prisma.user.findUnique({ where: { id: created.id } });
    if (row) createdAuthIds.push(row.authUserId);
    expect(created.companyId).toBe(companyAId);
  });

  // ── ADMIN cross-company still works, and is ADMIN-only ──────────────────────
  it('ADMIN ?companyId=B → only B; MANAGER-A can never get allCompanies', async () => {
    const res = await get(`/users?pageSize=200&companyId=${companyBId}`, adminToken);
    const companies = (res.json().items as Array<{ companyId: string }>).map((u) => u.companyId);
    expect(companies.length).toBeGreaterThan(0);
    expect(companies.every((c) => c === companyBId)).toBe(true);

    const { resolveCompanyScope, effectiveCompanyScope } = await import('../src/lib/scope.js');
    expect(resolveCompanyScope({ role: Role.MANAGER, companyId: companyAId } as never)).toEqual({ companyId: companyAId });
    expect(effectiveCompanyScope({ role: Role.MANAGER, companyId: companyAId } as never, companyBId)).toEqual({ companyId: companyAId });
    expect(effectiveCompanyScope({ role: Role.ADMIN, companyId: '' } as never, companyBId)).toEqual({ companyId: companyBId });
  });

  // ── Companies module authz ──────────────────────────────────────────────────
  it('MANAGER-A → 403 on all /companies routes (list/create/patch/archive/unarchive)', async () => {
    expect((await get('/companies', mgrAToken)).statusCode).toBe(403);
    expect((await post('/companies', mgrAToken, { name: 'X' })).statusCode).toBe(403);
    expect((await patch(`/companies/${companyAId}`, mgrAToken, { name: 'X' })).statusCode).toBe(403);
    expect((await post(`/companies/${companyAId}/archive`, mgrAToken, {})).statusCode).toBe(403);
    expect((await post(`/companies/${companyAId}/unarchive`, mgrAToken, {})).statusCode).toBe(403);
  });

  it('1:1 Company↔Customer @unique cannot be violated → 409 on second link', async () => {
    const customer = await prisma.customer.create({ data: { name: `NX Cust ${uniq()}` } });
    const c1 = await post('/companies', adminToken, { name: `NX Link1 ${uniq()}`, customerId: customer.id });
    expect(c1.statusCode).toBe(201);
    const c2 = await post('/companies', adminToken, { name: `NX Link2 ${uniq()}`, customerId: customer.id });
    expect(c2.statusCode).toBe(409);
    await prisma.company.delete({ where: { id: c1.json().id } }).catch(() => undefined);
    await prisma.customer.delete({ where: { id: customer.id } }).catch(() => undefined);
  });

  // ── Fail-closed ─────────────────────────────────────────────────────────────
  it('resolveCompanyScope fails CLOSED for a non-admin with empty companyId', async () => {
    const { resolveCompanyScope } = await import('../src/lib/scope.js');
    for (const r of [Role.MANAGER, Role.FOREMAN, Role.WORKER, Role.PARTNER]) {
      expect(() => resolveCompanyScope({ role: r, companyId: '' } as never)).toThrowError();
    }
  });

  // ── Backfill integrity (live DB) ────────────────────────────────────────────
  it('BACKFILL: 0 users with a NULL/empty companyId; Default Company exists', async () => {
    const orphans = await prisma.user.count({ where: { companyId: '' } });
    expect(orphans).toBe(0);
    const def = await prisma.company.findUnique({ where: { id: DEFAULT_COMPANY_ID } });
    expect(def).not.toBeNull();
  });

  it('BACKFILL: every user references a REAL Company (no dangling companyId)', async () => {
    const distinct = await prisma.user.findMany({ distinct: ['companyId'], select: { companyId: true } });
    const companyIds = distinct.map((d) => d.companyId);
    const found = await prisma.company.findMany({ where: { id: { in: companyIds } }, select: { id: true } });
    expect(found.length).toBe(companyIds.length);
  });
});
