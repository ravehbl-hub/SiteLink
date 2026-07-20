/**
 * PersonnelCompany (staffing companies) — ADMIN/MANAGER CRUD, org-wide, Manager-only.
 *
 * LIVE-DB / LIVE-SUPABASE: exercises the real query path end to end against the
 * provisioned Supabase Postgres (migrated + seeded). Not mocked — the module-scope
 * prisma singleton talks to the pooler via DATABASE_URL. We forge Supabase-shaped
 * HS256 JWTs with the real project secret and point `sub` at real User.authUserId
 * rows we create in beforeAll (ADMIN, MANAGER, FOREMAN, WORKER), so the auth plugin
 * admits us the same way a genuine Supabase access token would.
 *
 * P1001 (can't reach DB) under a network-restricted sandbox is a FALSE NEGATIVE —
 * re-run with the live-DB harness. Every row/identity created here is removed in
 * afterAll so the run is idempotent.
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

// Stable authUserIds we own for these tests (one per role).
const IDS = {
  admin: `pc-test-admin-${randomUUID().slice(0, 8)}`,
  manager: `pc-test-manager-${randomUUID().slice(0, 8)}`,
  foreman: `pc-test-foreman-${randomUUID().slice(0, 8)}`,
  worker: `pc-test-worker-${randomUUID().slice(0, 8)}`,
};
const tokens: Record<keyof typeof IDS, string> = {} as never;
const createdUserIds: string[] = [];
const createdCompanyIds: string[] = [];
const createdWorkerIds: string[] = [];

async function makeUser(authUserId: string, role: Role): Promise<void> {
  const u = await prisma.user.upsert({
    where: { email: `${authUserId}@sitelink.test` },
    update: { role, isLockedOut: false, authUserId },
    create: {
      authUserId,
      companyId: 'cl000000000000000000default',
      role,
      fullName: `PC Test ${role}`,
      email: `${authUserId}@sitelink.test`,
    },
  });
  createdUserIds.push(u.id);
}

beforeAll(async () => {
  app = await buildApp(loadConfig());
  await app.ready();

  await makeUser(IDS.admin, Role.ADMIN);
  await makeUser(IDS.manager, Role.MANAGER);
  await makeUser(IDS.foreman, Role.FOREMAN);
  await makeUser(IDS.worker, Role.WORKER);

  tokens.admin = await signFor(IDS.admin);
  tokens.manager = await signFor(IDS.manager);
  tokens.foreman = await signFor(IDS.foreman);
  tokens.worker = await signFor(IDS.worker);
}, 30_000);

afterAll(async () => {
  // Workers first (they may reference companies via the FK).
  for (const id of createdWorkerIds) {
    await prisma.worker.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of createdCompanyIds) {
    await prisma.personnelCompany.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of createdUserIds) {
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  await app.close();
  await prisma.$disconnect();
}, 30_000);

describe('PersonnelCompany CRUD — ADMIN/MANAGER (org-wide, Manager-only)', () => {
  it('MANAGER can create, get, update; ADMIN can too', async () => {
    const name = `Acme Staffing ${randomUUID().slice(0, 8)}`;

    // create (MANAGER)
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/personnel-companies',
      headers: auth(tokens.manager),
      payload: { name, contactName: 'Jane', phone: '+972-3-000', email: 'jane@acme.test' },
    });
    expect(created.statusCode).toBe(201);
    const company = created.json();
    createdCompanyIds.push(company.id);
    expect(company.name).toBe(name);
    expect(company.contactName).toBe('Jane');
    expect(company.email).toBe('jane@acme.test');
    expect(company.isArchived).toBe(false);
    expect(typeof company.createdAt).toBe('string');

    // get one (ADMIN)
    const got = await app.inject({
      method: 'GET',
      url: `/api/v1/personnel-companies/${company.id}`,
      headers: auth(tokens.admin),
    });
    expect(got.statusCode).toBe(200);
    expect(got.json().id).toBe(company.id);

    // update (partial) — change contact only
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/personnel-companies/${company.id}`,
      headers: auth(tokens.manager),
      payload: { contactName: 'John', phone: null },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().contactName).toBe('John');
    expect(patched.json().phone).toBeNull();
    expect(patched.json().name).toBe(name); // unchanged
  });

  it('GET missing id → 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/personnel-companies/does-not-exist-xyz',
      headers: auth(tokens.manager),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('duplicate name → friendly 409 CONFLICT', async () => {
    const name = `Dup Co ${randomUUID().slice(0, 8)}`;
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/personnel-companies',
      headers: auth(tokens.manager),
      payload: { name },
    });
    expect(first.statusCode).toBe(201);
    createdCompanyIds.push(first.json().id);

    const dup = await app.inject({
      method: 'POST',
      url: '/api/v1/personnel-companies',
      headers: auth(tokens.manager),
      payload: { name },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('CONFLICT');
    expect(dup.json().error.message).toMatch(/already exists/i);
  });

  it('create without name → 400 VALIDATION', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/personnel-companies',
      headers: auth(tokens.manager),
      payload: { contactName: 'Nameless' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
  });

  it('list: excludes archived by default; includeArchived=true includes them; pagination shape', async () => {
    const name = `Archy Co ${randomUUID().slice(0, 8)}`;
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/personnel-companies',
      headers: auth(tokens.manager),
      payload: { name },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    createdCompanyIds.push(id);

    // archive it
    const arch = await app.inject({
      method: 'POST',
      url: `/api/v1/personnel-companies/${id}/archive`,
      headers: auth(tokens.manager),
    });
    expect(arch.statusCode).toBe(200);
    expect(arch.json().isArchived).toBe(true);

    // default list excludes it + correct Paginated shape
    const def = await app.inject({
      method: 'GET',
      url: '/api/v1/personnel-companies?page=1&pageSize=200',
      headers: auth(tokens.manager),
    });
    expect(def.statusCode).toBe(200);
    const body = def.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(typeof body.total).toBe('number');
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(200);
    expect(body.items.map((c: { id: string }) => c.id)).not.toContain(id);

    // includeArchived=true surfaces it
    const inc = await app.inject({
      method: 'GET',
      url: '/api/v1/personnel-companies?page=1&pageSize=200&includeArchived=true',
      headers: auth(tokens.manager),
    });
    expect(inc.statusCode).toBe(200);
    expect(inc.json().items.map((c: { id: string }) => c.id)).toContain(id);

    // unarchive → back in default list
    const un = await app.inject({
      method: 'POST',
      url: `/api/v1/personnel-companies/${id}/unarchive`,
      headers: auth(tokens.manager),
    });
    expect(un.statusCode).toBe(200);
    expect(un.json().isArchived).toBe(false);

    const def2 = await app.inject({
      method: 'GET',
      url: '/api/v1/personnel-companies?page=1&pageSize=200',
      headers: auth(tokens.manager),
    });
    expect(def2.json().items.map((c: { id: string }) => c.id)).toContain(id);
  });
});

describe('PersonnelCompany REMOVE — HARD delete (MANAGER-only) + SetNull unlinks workers', () => {
  it('MANAGER DELETE → 204 and the company is gone (GET → 404)', async () => {
    const name = `Del Co ${randomUUID().slice(0, 8)}`;
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/personnel-companies',
      headers: auth(tokens.manager),
      payload: { name },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/personnel-companies/${id}`,
      headers: auth(tokens.manager),
    });
    expect(del.statusCode).toBe(204);
    expect(del.body).toBe('');

    // Gone: GET the same id → 404.
    const got = await app.inject({
      method: 'GET',
      url: `/api/v1/personnel-companies/${id}`,
      headers: auth(tokens.manager),
    });
    expect(got.statusCode).toBe(404);
    expect(got.json().error.code).toBe('NOT_FOUND');
  });

  it('ADMIN can DELETE too → 204', async () => {
    const name = `Admin Del Co ${randomUUID().slice(0, 8)}`;
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/personnel-companies',
      headers: auth(tokens.manager),
      payload: { name },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/personnel-companies/${id}`,
      headers: auth(tokens.admin),
    });
    expect(del.statusCode).toBe(204);
  });

  it('DELETE a company LINKED to a worker → 204; worker survives, its personnelCompanyId is NULLed (SetNull)', async () => {
    // Company + a worker directly linked via the FK.
    const name = `Linked Co ${randomUUID().slice(0, 8)}`;
    const company = await prisma.personnelCompany.create({
      data: { companyId: 'cl000000000000000000default', name },
    });

    const worker = await prisma.worker.create({
      data: {
        companyId: 'cl000000000000000000default',
        firstName: 'Link',
        lastName: 'Tester',
        profession: 'GENERAL_LABORER',
        personnelCompany: name, // free-text mirror (independent column)
        personnelCompanyId: company.id, // managed FK
      },
    });
    createdWorkerIds.push(worker.id);

    // Sanity: the link exists before delete.
    const before = await prisma.worker.findUnique({
      where: { id: worker.id },
      select: { personnelCompanyId: true, personnelCompany: true },
    });
    expect(before!.personnelCompanyId).toBe(company.id);

    // Delete the company (MANAGER).
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/personnel-companies/${company.id}`,
      headers: auth(tokens.manager),
    });
    expect(del.statusCode).toBe(204);

    // Company is gone.
    const got = await app.inject({
      method: 'GET',
      url: `/api/v1/personnel-companies/${company.id}`,
      headers: auth(tokens.manager),
    });
    expect(got.statusCode).toBe(404);

    // Worker STILL exists; FK was SET NULL; free-text mirror is untouched.
    const after = await prisma.worker.findUnique({
      where: { id: worker.id },
      select: { id: true, personnelCompanyId: true, personnelCompany: true },
    });
    expect(after).not.toBeNull();
    expect(after!.id).toBe(worker.id);
    expect(after!.personnelCompanyId).toBeNull(); // SetNull worked
    expect(after!.personnelCompany).toBe(name); // free-text mirror preserved
  });

  it('DELETE nonexistent id → 404', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/personnel-companies/does-not-exist-${randomUUID().slice(0, 8)}`,
      headers: auth(tokens.manager),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});

describe('PersonnelCompany authz — WRITE MANAGER-only; READ also FOREMAN; WORKER 403', () => {
  // WRITE surfaces stay MANAGER-only: a FOREMAN (read-only) and a WORKER get 403.
  const writeRoutes: Array<{
    method: 'POST' | 'PATCH' | 'DELETE';
    url: string;
    payload?: unknown;
  }> = [
    { method: 'POST', url: '/api/v1/personnel-companies', payload: { name: 'X' } },
    { method: 'PATCH', url: '/api/v1/personnel-companies/some-id', payload: { name: 'Y' } },
    { method: 'POST', url: '/api/v1/personnel-companies/some-id/archive' },
    { method: 'POST', url: '/api/v1/personnel-companies/some-id/unarchive' },
    // DELETE is on the MANAGER-only `guard` (not `readGuard`): foreman + worker get 403.
    { method: 'DELETE', url: '/api/v1/personnel-companies/some-id' },
  ];
  // READ surfaces: FOREMAN is now allowed (picker); WORKER is still 403.
  const readRoutes: Array<{ method: 'GET'; url: string }> = [
    { method: 'GET', url: '/api/v1/personnel-companies' },
    { method: 'GET', url: '/api/v1/personnel-companies/some-id' },
  ];

  // Both foreman + worker are refused on every WRITE route.
  for (const who of ['foreman', 'worker'] as const) {
    for (const r of writeRoutes) {
      it(`${who} → 403 on WRITE ${r.method} ${r.url}`, async () => {
        const res = await app.inject({
          method: r.method,
          url: r.url,
          headers: auth(tokens[who]),
          payload: r.payload,
        });
        expect(res.statusCode).toBe(403);
        expect(res.json().error.code).toBe('FORBIDDEN');
        // No resource data leaked on a 403.
        expect(Object.keys(res.json())).toEqual(['error']);
      });
    }
  }

  // WORKER stays 403 on READS too.
  for (const r of readRoutes) {
    it(`worker → 403 on READ ${r.method} ${r.url}`, async () => {
      const res = await app.inject({
        method: r.method,
        url: r.url,
        headers: auth(tokens.worker),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('FORBIDDEN');
      expect(Object.keys(res.json())).toEqual(['error']);
    });
  }

  // FOREMAN is now ALLOWED on the two READ routes (200 list / 404 missing-id, never 403).
  it('foreman → 200 on GET list (picker read)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/personnel-companies?page=1&pageSize=50',
      headers: auth(tokens.foreman),
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().items)).toBe(true);
  });

  it('foreman → GET a real company by id → 200 (read-only)', async () => {
    // Manager creates a company; foreman must be able to read it back.
    const name = `Foreman Read Co ${randomUUID().slice(0, 8)}`;
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/personnel-companies',
      headers: auth(tokens.manager),
      payload: { name },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    createdCompanyIds.push(id);

    const got = await app.inject({
      method: 'GET',
      url: `/api/v1/personnel-companies/${id}`,
      headers: auth(tokens.foreman),
    });
    expect(got.statusCode).toBe(200);
    expect(got.json().id).toBe(id);
  });

  it('foreman → GET missing id → 404 (reaches the handler, not a 403 gate)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/personnel-companies/does-not-exist-foreman',
      headers: auth(tokens.foreman),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});
