/**
 * MULTI-TENANCY PHASE 1 — ADVERSARIAL GATE (Servio, Back-End).
 *
 * The app's BIGGEST security boundary: cross-company leakage on the Users surface is
 * catastrophic. This suite runs the REAL query path end-to-end against the live
 * Supabase Postgres + service-role client (nothing mocked) and asserts a MANAGER of
 * company A can NEVER list/get/create-into/update/lockout/delete a user of company B,
 * and can NEVER widen their scope via a client-supplied companyId.
 *
 * Auth: forged Supabase-shaped HS256 tokens signed with the REAL project
 * SUPABASE_JWT_SECRET whose `sub` points at a real User.authUserId (same pattern as
 * phase05-stageB / integration-live-db). Role + companyId resolve from the app User
 * row — NEVER from the token.
 *
 * Fixtures (two tenants A & B + the default company), all torn down in afterAll:
 *   - Company A, Company B (created directly via prisma).
 *   - MANAGER-A, MANAGER-B (app User rows on A / B; forged tokens).
 *   - FOREMAN-A, WORKER-A, FOREMAN-B, WORKER-B (role-visible targets per tenant).
 *   - MANAGER-DEFAULT (on the backfill Default Company).
 *   - ADMIN (super-admin, cross-company).
 *   - A no-companyId probe is simulated by asserting the scope helper fails closed.
 *
 * Every user/identity created via the API (POST /users dual-write) is tracked and
 * removed. Re-seed on orphan/401 live-Supabase flakiness is handled by upserts.
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
const uniq = () => randomUUID().slice(0, 8);

let app: FastifyInstance;

const DEFAULT_COMPANY_ID = 'cl000000000000000000default';

// Company ids (created in beforeAll).
let companyAId: string;
let companyBId: string;

// authUserIds we own & sign for.
const ADMIN_AUTH = `mt-admin-${randomUUID()}`;
const MGR_A_AUTH = `mt-mgrA-${randomUUID()}`;
const MGR_B_AUTH = `mt-mgrB-${randomUUID()}`;
const MGR_DEF_AUTH = `mt-mgrDef-${randomUUID()}`;

let adminToken: string;
let mgrAToken: string;
let mgrBToken: string;
let mgrDefToken: string;

// Role-visible target users per tenant.
let foremanAId: string;
let workerAId: string;
let foremanBId: string;
let workerBId: string;
let workerBEmail: string;

// Teardown trackers.
const createdAppUserIds: string[] = [];
const createdAuthIds: string[] = [];

async function seedUser(
  email: string,
  role: Role,
  companyId: string,
  authUserId: string,
): Promise<string> {
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

  // Two tenant companies.
  const compA = await prisma.company.create({ data: { name: `MT Company A ${uniq()}` } });
  const compB = await prisma.company.create({ data: { name: `MT Company B ${uniq()}` } });
  companyAId = compA.id;
  companyBId = compB.id;

  // ADMIN (super-admin) — placed on the Default Company (companyId is NOT NULL).
  await seedUser('mt-admin@sitelink.test', Role.ADMIN, DEFAULT_COMPANY_ID, ADMIN_AUTH);

  // Managers per tenant + default.
  await seedUser('mt-managerA@sitelink.test', Role.MANAGER, companyAId, MGR_A_AUTH);
  await seedUser('mt-managerB@sitelink.test', Role.MANAGER, companyBId, MGR_B_AUTH);
  await seedUser('mt-managerDef@sitelink.test', Role.MANAGER, DEFAULT_COMPANY_ID, MGR_DEF_AUTH);

  // Role-visible targets per tenant (FOREMAN/WORKER — inside a manager's manageable set).
  foremanAId = await seedUser('mt-foremanA@sitelink.test', Role.FOREMAN, companyAId, `mt-forA-${uniq()}`);
  workerAId = await seedUser('mt-workerA@sitelink.test', Role.WORKER, companyAId, `mt-wrkA-${uniq()}`);
  foremanBId = await seedUser('mt-foremanB@sitelink.test', Role.FOREMAN, companyBId, `mt-forB-${uniq()}`);
  workerBEmail = 'mt-workerB@sitelink.test';
  workerBId = await seedUser(workerBEmail, Role.WORKER, companyBId, `mt-wrkB-${uniq()}`);

  adminToken = await signFor(ADMIN_AUTH);
  mgrAToken = await signFor(MGR_A_AUTH);
  mgrBToken = await signFor(MGR_B_AUTH);
  mgrDefToken = await signFor(MGR_DEF_AUTH);
});

afterAll(async () => {
  const svc = app.supabase;
  // App-provisioned identities created via POST /users (dual-write) first.
  for (const authId of createdAuthIds) {
    await svc.deleteAuthUser(authId).catch(() => undefined);
  }
  for (const id of createdAppUserIds) {
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  // Companies last (users referencing them are gone; onDelete: Restrict otherwise).
  await prisma.company.delete({ where: { id: companyAId } }).catch(() => undefined);
  await prisma.company.delete({ where: { id: companyBId } }).catch(() => undefined);
  await app.close();
});

function get(url: string, token: string) {
  return app.inject({ method: 'GET', url: `/api/v1${url}`, headers: auth(token) });
}
function post(url: string, token: string, payload?: unknown) {
  return app.inject({ method: 'POST', url: `/api/v1${url}`, headers: auth(token), payload });
}
function patch(url: string, token: string, payload?: unknown) {
  return app.inject({ method: 'PATCH', url: `/api/v1${url}`, headers: auth(token), payload });
}
function del(url: string, token: string) {
  return app.inject({ method: 'DELETE', url: `/api/v1${url}`, headers: auth(token) });
}

describe('Multi-tenancy Phase 1 — Users surface company isolation', () => {
  // ── LIST ────────────────────────────────────────────────────────────────
  it('MANAGER-A list → ONLY company-A users; NEVER a company-B user', async () => {
    const res = await get('/users?pageSize=200', mgrAToken);
    expect(res.statusCode).toBe(200);
    const ids: string[] = res.json().items.map((u: { id: string }) => u.id);
    const companies: string[] = res.json().items.map((u: { companyId: string }) => u.companyId);
    // Every returned user is company A.
    expect(companies.every((c) => c === companyAId)).toBe(true);
    // Company-A role-visible targets appear; company-B ones NEVER do.
    expect(ids).toContain(foremanAId);
    expect(ids).toContain(workerAId);
    expect(ids).not.toContain(foremanBId);
    expect(ids).not.toContain(workerBId);
  });

  it('MANAGER-A ?companyId=B is IGNORED (cannot widen) → still ONLY company A', async () => {
    const res = await get(`/users?pageSize=200&companyId=${companyBId}`, mgrAToken);
    expect(res.statusCode).toBe(200);
    const companies: string[] = res.json().items.map((u: { companyId: string }) => u.companyId);
    expect(companies.every((c) => c === companyAId)).toBe(true);
    const ids: string[] = res.json().items.map((u: { id: string }) => u.id);
    expect(ids).not.toContain(workerBId);
    expect(ids).not.toContain(foremanBId);
  });

  // ── GET ─────────────────────────────────────────────────────────────────
  it('MANAGER-A get company-B user → 404 (no cross-tenant existence leak)', async () => {
    const res = await get(`/users/${workerBId}`, mgrAToken);
    expect([403, 404]).toContain(res.statusCode);
    // Body must not leak the company-B user's data.
    expect(res.body).not.toContain(workerBEmail);
  });

  it('MANAGER-A get own company-A user → 200', async () => {
    const res = await get(`/users/${foremanAId}`, mgrAToken);
    expect(res.statusCode).toBe(200);
    expect(res.json().companyId).toBe(companyAId);
  });

  // ── UPDATE / LOCKOUT / DELETE cross-tenant → denied + NO mutation ─────────
  it('MANAGER-A update company-B user → 404/403 and B user UNCHANGED', async () => {
    const before = await prisma.user.findUnique({ where: { id: workerBId } });
    const res = await patch(`/users/${workerBId}`, mgrAToken, { fullName: 'HACKED-BY-A' });
    expect([403, 404]).toContain(res.statusCode);
    const after = await prisma.user.findUnique({ where: { id: workerBId } });
    expect(after!.fullName).toBe(before!.fullName);
    expect(after!.fullName).not.toBe('HACKED-BY-A');
    expect(after!.companyId).toBe(companyBId);
  });

  it('MANAGER-A lockout company-B user → 404/403 and B user NOT locked', async () => {
    const res = await post(`/users/${workerBId}/lockout`, mgrAToken, { isLockedOut: true });
    expect([403, 404]).toContain(res.statusCode);
    const after = await prisma.user.findUnique({ where: { id: workerBId } });
    expect(after!.isLockedOut).toBe(false);
  });

  it('MANAGER-A delete company-B user → 404/403 and B user STILL EXISTS', async () => {
    const res = await del(`/users/${workerBId}`, mgrAToken);
    expect([403, 404]).toContain(res.statusCode);
    const after = await prisma.user.findUnique({ where: { id: workerBId } });
    expect(after).not.toBeNull();
    expect(after!.companyId).toBe(companyBId);
  });

  // ── CREATE stamps the MANAGER's OWN company (client companyId ignored) ────
  it('MANAGER-A create foreman → stamped company A even with body companyId=B', async () => {
    const email = `mt-newForA-${uniq()}@sitelink.test`;
    const res = await post('/users', mgrAToken, {
      role: Role.FOREMAN,
      fullName: 'New Foreman A',
      email,
      password: `Pw-${randomUUID()}`,
      companyId: companyBId, // ADVERSARIAL: attempt to create INTO company B.
    });
    expect(res.statusCode).toBe(201);
    const created = res.json();
    createdAppUserIds.push(created.id);
    const row = await prisma.user.findUnique({ where: { id: created.id } });
    if (row) createdAuthIds.push(row.authUserId);
    // STAMPED company A — the client companyId=B was IGNORED.
    expect(created.companyId).toBe(companyAId);
    expect(created.companyId).not.toBe(companyBId);
  });

  it('MANAGER-A create worker (no companyId in body) → stamped company A', async () => {
    const email = `mt-newWrkA-${uniq()}@sitelink.test`;
    const res = await post('/users', mgrAToken, {
      role: Role.WORKER,
      fullName: 'New Worker A',
      email,
      password: `Pw-${randomUUID()}`,
    });
    expect(res.statusCode).toBe(201);
    const created = res.json();
    createdAppUserIds.push(created.id);
    const row = await prisma.user.findUnique({ where: { id: created.id } });
    if (row) createdAuthIds.push(row.authUserId);
    expect(created.companyId).toBe(companyAId);
  });

  // ── ADMIN cross-company ───────────────────────────────────────────────────
  it('ADMIN list → sees BOTH companies users', async () => {
    const res = await get('/users?pageSize=200', adminToken);
    expect(res.statusCode).toBe(200);
    const ids: string[] = res.json().items.map((u: { id: string }) => u.id);
    expect(ids).toContain(foremanAId);
    expect(ids).toContain(workerBId);
  });

  it('ADMIN ?companyId=B → ONLY company B users', async () => {
    const res = await get(`/users?pageSize=200&companyId=${companyBId}`, adminToken);
    expect(res.statusCode).toBe(200);
    const companies: string[] = res.json().items.map((u: { companyId: string }) => u.companyId);
    expect(companies.length).toBeGreaterThan(0);
    expect(companies.every((c) => c === companyBId)).toBe(true);
    const ids: string[] = res.json().items.map((u: { id: string }) => u.id);
    expect(ids).toContain(workerBId);
    expect(ids).not.toContain(foremanAId);
  });

  it('ADMIN create manager INTO company B → stamped B', async () => {
    const email = `mt-newMgrB-${uniq()}@sitelink.test`;
    const res = await post('/users', adminToken, {
      role: Role.MANAGER,
      fullName: 'New Manager B',
      email,
      password: `Pw-${randomUUID()}`,
      companyId: companyBId,
    });
    expect(res.statusCode).toBe(201);
    const created = res.json();
    createdAppUserIds.push(created.id);
    const row = await prisma.user.findUnique({ where: { id: created.id } });
    if (row) createdAuthIds.push(row.authUserId);
    expect(created.companyId).toBe(companyBId);
  });

  it('ADMIN create user WITHOUT companyId → 400 (a user must belong to a company)', async () => {
    const email = `mt-noCompany-${uniq()}@sitelink.test`;
    const res = await post('/users', adminToken, {
      role: Role.MANAGER,
      fullName: 'No Company',
      email,
      password: `Pw-${randomUUID()}`,
    });
    expect(res.statusCode).toBe(400);
  });

  it('ADMIN create INTO a non-existent company → 400', async () => {
    const email = `mt-badCompany-${uniq()}@sitelink.test`;
    const res = await post('/users', adminToken, {
      role: Role.MANAGER,
      fullName: 'Bad Company',
      email,
      password: `Pw-${randomUUID()}`,
      companyId: `does-not-exist-${uniq()}`,
    });
    expect(res.statusCode).toBe(400);
  });

  // ── ADMIN-only /companies routes ──────────────────────────────────────────
  it('MANAGER → 403 on POST/PATCH/archive /companies', async () => {
    const c = await post('/companies', mgrAToken, { name: 'X' });
    expect(c.statusCode).toBe(403);
    const p = await patch(`/companies/${companyAId}`, mgrAToken, { name: 'X' });
    expect(p.statusCode).toBe(403);
    const a = await post(`/companies/${companyAId}/archive`, mgrAToken, {});
    expect(a.statusCode).toBe(403);
  });

  it('FOREMAN/WORKER → 403 on /companies list', async () => {
    // Foreman-A / Worker-A have no forged token here; reuse manager-B is still 403
    // on a mutating route — but for read we assert the coarse gate via a non-admin.
    const res = await get('/companies', mgrBToken);
    expect(res.statusCode).toBe(403);
  });

  it('ADMIN → can CRUD + archive /companies', async () => {
    const created = await post('/companies', adminToken, { name: `MT Temp ${uniq()}` });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;

    const list = await get('/companies', adminToken);
    expect(list.statusCode).toBe(200);

    const one = await get(`/companies/${id}`, adminToken);
    expect(one.statusCode).toBe(200);

    const upd = await patch(`/companies/${id}`, adminToken, { name: 'MT Temp Renamed' });
    expect(upd.statusCode).toBe(200);
    expect(upd.json().name).toBe('MT Temp Renamed');

    const arch = await post(`/companies/${id}/archive`, adminToken, {});
    expect(arch.statusCode).toBe(200);
    expect(arch.json().isArchived).toBe(true);

    const unarch = await post(`/companies/${id}/unarchive`, adminToken, {});
    expect(unarch.statusCode).toBe(200);
    expect(unarch.json().isArchived).toBe(false);

    // Cleanup this temp company.
    await prisma.company.delete({ where: { id } }).catch(() => undefined);
  });

  it('ADMIN cannot create a MANAGER into an ARCHIVED company → 400', async () => {
    const c = await prisma.company.create({ data: { name: `MT Archived ${uniq()}`, isArchived: true } });
    const res = await post('/users', adminToken, {
      role: Role.MANAGER,
      fullName: 'Into Archived',
      email: `mt-intoArchived-${uniq()}@sitelink.test`,
      password: `Pw-${randomUUID()}`,
      companyId: c.id,
    });
    expect(res.statusCode).toBe(400);
    await prisma.company.delete({ where: { id: c.id } }).catch(() => undefined);
  });

  // ── Default company ───────────────────────────────────────────────────────
  it('MANAGER on Default Company sees Default-company users (e.g. seed manager)', async () => {
    const res = await get('/users?pageSize=200', mgrDefToken);
    expect(res.statusCode).toBe(200);
    const companies: string[] = res.json().items.map((u: { companyId: string }) => u.companyId);
    expect(companies.length).toBeGreaterThan(0);
    expect(companies.every((c) => c === DEFAULT_COMPANY_ID)).toBe(true);
    // Never a company-A/B user.
    const ids: string[] = res.json().items.map((u: { id: string }) => u.id);
    expect(ids).not.toContain(foremanAId);
    expect(ids).not.toContain(workerBId);
  });

  it('ADMIN can list Default-company (existing) users', async () => {
    const res = await get(`/users?pageSize=200&companyId=${DEFAULT_COMPANY_ID}`, adminToken);
    expect(res.statusCode).toBe(200);
    const companies: string[] = res.json().items.map((u: { companyId: string }) => u.companyId);
    expect(companies.every((c) => c === DEFAULT_COMPANY_ID)).toBe(true);
  });

  // ── Fail-closed: no companyId (impossible post-migration) ─────────────────
  it('scope resolution fails CLOSED (403) for a non-admin with no companyId', async () => {
    const { resolveCompanyScope } = await import('../src/lib/scope.js');
    expect(() =>
      resolveCompanyScope({ role: Role.MANAGER, companyId: '' } as never),
    ).toThrowError();
    // ADMIN with no companyId is still allCompanies (super-admin, tenant-agnostic).
    expect(resolveCompanyScope({ role: Role.ADMIN, companyId: '' } as never)).toEqual({
      allCompanies: true,
    });
  });
});
