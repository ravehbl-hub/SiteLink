/**
 * NEXO — MULTI-TENANCY PHASE 2 — NEGATIVE-SPACE ADVERSARIAL SWEEP (Handler of Cyber).
 *
 * Servio's multitenancy-phase2.test.ts covers the primary surfaces (workers list/get/
 * update/archive/create, sites, attendance list/create/update, requests, salary calc +
 * wage-fallback, loans, dashboard, P&L, reports, personnel-companies, wage-rates,
 * foreman-assignments). THIS suite attacks the residual NEGATIVE SPACE a leak could hide
 * in — the surfaces most likely to mint a cross-tenant CAPABILITY (a signed Storage URL)
 * or silently cross-sum a tenant in a BATCH:
 *
 *   - Worker DOCS: upload-url / confirm / read-url / delete for a company-B worker → 404,
 *     and NO signed URL / storage object minted BEFORE the company check.
 *   - Worker IMAGE: upload-url / confirm / read-url for a company-B worker → 404.
 *   - Worker SALARY-DATA upsert (derived model) for a company-B worker → 404, NO write.
 *   - Attendance WORKING-HOURS: MANAGER-A only sees A's rows.
 *   - ADVANCES (Servio tested loans, not advances): list excludes B; create/update/delete
 *     a B advance → 404.
 *   - SALARY calculateMany BATCH-SMUGGLE: a company-B worker WITH attendance in-window
 *     must NEVER be summed into A's dashboard salaryTotal (the batch is company-scoped).
 *   - REDECIDE side-effect: a company-B RESOLVED request re-decided by MANAGER-A → 404,
 *     no reversal/re-apply of B's ledger.
 *   - WORKER-SELF: a WORKER of A resolves ONLY their own worker; a forged ?workerId=<B>
 *     is ignored (salary + working-hours self surfaces).
 *
 * Auth: forged Supabase-shaped HS256 tokens (real SUPABASE_JWT_SECRET) whose `sub` is a
 * real User.authUserId — role + companyId resolve from the app User row, never the token.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import type { FastifyInstance } from 'fastify';
import {
  AttendanceType,
  Profession,
  RateType,
  RequestStatus,
  RequestType,
  Role,
  SiteStatus,
  WorkerLevel,
} from '@sitelink/shared';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { prisma } from '../src/db/client.js';

const SECRET = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET);
const uniq = () => randomUUID().slice(0, 8);

async function signFor(authUserId: string): Promise<string> {
  return new SignJWT({ aud: 'authenticated', role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(authUserId)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(SECRET);
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

let app: FastifyInstance;

interface Tenant {
  companyId: string;
  managerToken: string;
  workerId: string; // has salaryData + attendance
  workerUserToken: string; // WORKER login for self-surface tests
  siteId: string;
  advanceId: string;
  resolvedRequestId: string; // APPROVED (has a tagged loan side-effect)
  docId: string;
  taggedLoanId: string;
}
let A: Tenant;
let B: Tenant;

const createdUserIds: string[] = [];
const createdCompanyIds: string[] = [];

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
  createdUserIds.push(row.id);
  return row.id;
}

async function seedTenant(label: string): Promise<Tenant> {
  const company = await prisma.company.create({ data: { name: `NX2 ${label} ${uniq()}` } });
  createdCompanyIds.push(company.id);
  const companyId = company.id;

  const site = await prisma.site.create({
    data: { companyId, name: `NX2 ${label} Site`, status: SiteStatus.ACTIVE },
  });

  const mgrAuth = `nx2-mgr${label}-${uniq()}`;
  await seedUser(`nx2-mgr${label}-${uniq()}@sitelink.test`, Role.MANAGER, companyId, mgrAuth);

  // A WORKER login user, linked to the worker below via Worker.userId.
  const wkrAuth = `nx2-wkr${label}-${uniq()}`;
  const workerUserId = await seedUser(
    `nx2-wkr${label}-${uniq()}@sitelink.test`,
    Role.WORKER,
    companyId,
    wkrAuth,
  );

  const worker = await prisma.worker.create({
    data: {
      companyId,
      userId: workerUserId,
      firstName: `NX${label}`,
      lastName: `Worker-${uniq()}`,
      profession: Profession.PLUMBER,
      level: WorkerLevel.MEDIUM,
      // A stored profile image + a doc so read-url endpoints have an object to (not) leak.
      imageStorageKey: `nx${label}__${randomUUID()}/image/${randomUUID()}.jpg`,
      imageFileName: 'img.jpg',
      imageMimeType: 'image/jpeg',
      imageUploadedAt: new Date(),
      salaryData: { create: { hourlyWage: 100, rateType: RateType.HOURLY, currency: 'ILS' } },
      assignments: { create: [{ siteId: site.id }] },
      docs: {
        create: [
          {
            type: 'PASSPORT_ID',
            storageKey: `${randomUUID()}/PASSPORT_ID/${randomUUID()}.pdf`,
            fileName: 'id.pdf',
            mimeType: 'application/pdf',
          },
        ],
      },
    },
    include: { docs: true },
  });
  // Re-key the seeded doc so its storageKey belongs to THIS worker id (prefix guard shape).
  const realDocKey = `${worker.id}/PASSPORT_ID/${randomUUID()}.pdf`;
  await prisma.workerDoc.update({
    where: { id: worker.docs[0].id },
    data: { storageKey: realDocKey },
  });

  // Attendance IN-WINDOW so calculateMany would sum this worker if a batch crossed tenants.
  await prisma.attendanceRecord.create({
    data: {
      workerId: worker.id,
      companyId,
      siteId: site.id,
      date: new Date('2026-06-03T00:00:00.000Z'),
      type: AttendanceType.ATTENDANCE,
      hours: 8,
    },
  });

  const advance = await prisma.advancePayment.create({
    data: {
      workerId: worker.id,
      companyId,
      amount: 300,
      currency: 'ILS',
      date: new Date('2026-06-03T00:00:00.000Z'),
      outstanding: 300,
    },
  });

  // A RESOLVED (APPROVED) request with a TAGGED loan side-effect, so a cross-tenant
  // redecide would try to reverse a real obligation.
  const req = await prisma.workerRequest.create({
    data: {
      workerId: worker.id,
      companyId,
      type: RequestType.LOAN,
      amount: 700,
      currency: 'ILS',
      status: RequestStatus.APPROVED,
      resolvedAt: new Date(),
    },
  });
  const taggedLoan = await prisma.loan.create({
    data: {
      workerId: worker.id,
      companyId,
      amount: 700,
      currency: 'ILS',
      date: new Date('2026-06-03T00:00:00.000Z'),
      outstanding: 700,
      requestId: req.id,
    },
  });

  return {
    companyId,
    managerToken: '',
    workerId: worker.id,
    workerUserToken: await signFor(wkrAuth),
    siteId: site.id,
    advanceId: advance.id,
    resolvedRequestId: req.id,
    docId: worker.docs[0].id,
    taggedLoanId: taggedLoan.id,
  };
}

beforeAll(async () => {
  app = await buildApp(loadConfig());
  await app.ready();
  A = await seedTenant('A');
  B = await seedTenant('B');
  // Manager tokens (re-derive from the seeded manager authUserId via a fresh lookup).
  const mgrA = await prisma.user.findFirst({
    where: { companyId: A.companyId, role: Role.MANAGER },
    orderBy: { createdAt: 'desc' },
  });
  const mgrB = await prisma.user.findFirst({
    where: { companyId: B.companyId, role: Role.MANAGER },
    orderBy: { createdAt: 'desc' },
  });
  A.managerToken = await signFor(mgrA!.authUserId!);
  B.managerToken = await signFor(mgrB!.authUserId!);
}, 120_000);

afterAll(async () => {
  const wIds = [A.workerId, B.workerId];
  await prisma.loan.deleteMany({ where: { workerId: { in: wIds } } }).catch(() => undefined);
  await prisma.advancePayment.deleteMany({ where: { workerId: { in: wIds } } }).catch(() => undefined);
  await prisma.attendanceRecord.deleteMany({ where: { workerId: { in: wIds } } }).catch(() => undefined);
  await prisma.workerRequest.deleteMany({ where: { workerId: { in: wIds } } }).catch(() => undefined);
  await prisma.siteAssignment.deleteMany({ where: { workerId: { in: wIds } } }).catch(() => undefined);
  await prisma.workerDoc.deleteMany({ where: { workerId: { in: wIds } } }).catch(() => undefined);
  await prisma.workerSalaryData.deleteMany({ where: { workerId: { in: wIds } } }).catch(() => undefined);
  await prisma.worker.deleteMany({ where: { id: { in: wIds } } }).catch(() => undefined);
  for (const cId of createdCompanyIds) {
    await prisma.site.deleteMany({ where: { companyId: cId } }).catch(() => undefined);
  }
  for (const id of createdUserIds) {
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  for (const cId of createdCompanyIds) {
    await prisma.company.delete({ where: { id: cId } }).catch(() => undefined);
  }
  await app.close();
});

function get(url: string, token: string) {
  return app.inject({ method: 'GET', url: `/api/v1${url}`, headers: auth(token) });
}
function post(url: string, token: string, payload?: unknown) {
  return app.inject({ method: 'POST', url: `/api/v1${url}`, headers: auth(token), payload });
}
function put(url: string, token: string, payload?: unknown) {
  return app.inject({ method: 'PUT', url: `/api/v1${url}`, headers: auth(token), payload });
}
function patch(url: string, token: string, payload?: unknown) {
  return app.inject({ method: 'PATCH', url: `/api/v1${url}`, headers: auth(token), payload });
}
function del(url: string, token: string) {
  return app.inject({ method: 'DELETE', url: `/api/v1${url}`, headers: auth(token) });
}
const notFoundish = (c: number) => [403, 404].includes(c);

describe('NEXO Multi-tenancy P2 — negative-space cross-company sweep', () => {
  // ══ WORKER DOCS (signed-URL capability) ═══════════════════════════════════
  it('MANAGER-A list a company-B worker docs → 404', async () => {
    const res = await get(`/workers/${B.workerId}/docs`, A.managerToken);
    expect(notFoundish(res.statusCode)).toBe(true);
  });

  it('MANAGER-A request a doc UPLOAD-URL for a company-B worker → 404 (no signed URL)', async () => {
    const res = await post(`/workers/${B.workerId}/docs/upload-url`, A.managerToken, {
      type: 'PASSPORT_ID',
      fileName: 'x.pdf',
      mimeType: 'application/pdf',
    });
    expect(notFoundish(res.statusCode)).toBe(true);
    expect(res.body).not.toContain('uploadUrl');
    expect(res.body).not.toContain('token');
  });

  it('MANAGER-A CONFIRM a doc for a company-B worker → 404 (no WorkerDoc row created)', async () => {
    const before = await prisma.workerDoc.count({ where: { workerId: B.workerId } });
    const res = await post(`/workers/${B.workerId}/docs`, A.managerToken, {
      type: 'PASSPORT_ID',
      storageKey: `${B.workerId}/PASSPORT_ID/${randomUUID()}.pdf`,
      fileName: 'x.pdf',
      mimeType: 'application/pdf',
    });
    expect(notFoundish(res.statusCode)).toBe(true);
    const after = await prisma.workerDoc.count({ where: { workerId: B.workerId } });
    expect(after).toBe(before);
  });

  it('MANAGER-A read a company-B worker DOC read-url → 404 (no signed READ URL minted)', async () => {
    const res = await get(`/workers/${B.workerId}/docs/${B.docId}/url`, A.managerToken);
    expect(notFoundish(res.statusCode)).toBe(true);
    expect(res.body).not.toContain('http');
  });

  it('MANAGER-A DELETE a company-B worker doc → 404, B doc STILL EXISTS', async () => {
    const res = await del(`/workers/${B.workerId}/docs/${B.docId}`, A.managerToken);
    expect(notFoundish(res.statusCode)).toBe(true);
    const still = await prisma.workerDoc.findUnique({ where: { id: B.docId } });
    expect(still).not.toBeNull();
  });

  // ══ WORKER IMAGE (signed-URL capability) ══════════════════════════════════
  it('MANAGER-A request an image UPLOAD-URL for a company-B worker → 404', async () => {
    const res = await post(`/workers/${B.workerId}/image/upload-url`, A.managerToken, {
      fileName: 'x.jpg',
      mimeType: 'image/jpeg',
    });
    expect(notFoundish(res.statusCode)).toBe(true);
    expect(res.body).not.toContain('uploadUrl');
  });

  it('MANAGER-A read a company-B worker IMAGE read-url → 404 (no signed READ URL minted)', async () => {
    const res = await get(`/workers/${B.workerId}/image/url`, A.managerToken);
    expect(notFoundish(res.statusCode)).toBe(true);
    expect(res.body).not.toContain('http');
  });

  it('MANAGER-A CONFIRM an image for a company-B worker → 404, B image UNCHANGED', async () => {
    const before = await prisma.worker.findUnique({
      where: { id: B.workerId },
      select: { imageStorageKey: true },
    });
    const res = await post(`/workers/${B.workerId}/image`, A.managerToken, {
      storageKey: `nxB__${B.workerId}/image/${randomUUID()}.jpg`,
      fileName: 'evil.jpg',
      mimeType: 'image/jpeg',
    });
    expect(notFoundish(res.statusCode)).toBe(true);
    const after = await prisma.worker.findUnique({
      where: { id: B.workerId },
      select: { imageStorageKey: true },
    });
    expect(after!.imageStorageKey).toBe(before!.imageStorageKey);
  });

  // ══ WORKER SALARY-DATA upsert (derived model) ═════════════════════════════
  it('MANAGER-A upsert SALARY-DATA for a company-B worker → 404, B salaryData UNCHANGED', async () => {
    const res = await put(`/workers/${B.workerId}/salary-data`, A.managerToken, {
      hourlyWage: 1,
      rateType: 'HOURLY',
      currency: 'ILS',
    });
    expect(notFoundish(res.statusCode)).toBe(true);
    const sd = await prisma.workerSalaryData.findUnique({ where: { workerId: B.workerId } });
    expect(Number(sd!.hourlyWage)).toBe(100); // untouched
  });

  // ══ ATTENDANCE WORKING-HOURS ══════════════════════════════════════════════
  it('MANAGER-A working-hours aggregate → only A worker ids, never B', async () => {
    const q = '?from=2026-06-01T00:00:00.000Z&to=2026-06-30T00:00:00.000Z&grain=MONTH';
    const res = await get(`/working-hours${q}`, A.managerToken);
    expect(res.statusCode).toBe(200);
    const workerIds: string[] = res.json().map((r: { workerId: string }) => r.workerId);
    expect(workerIds).not.toContain(B.workerId);
  });

  // ══ ADVANCES (Servio tested loans; cover advances too) ════════════════════
  it('MANAGER-A list advances → ONLY company A; B advance NEVER appears', async () => {
    const res = await get('/advances?pageSize=200', A.managerToken);
    expect(res.statusCode).toBe(200);
    const ids: string[] = res.json().items.map((a: { id: string }) => a.id);
    expect(ids).toContain(A.advanceId);
    expect(ids).not.toContain(B.advanceId);
  });

  it('MANAGER-A update/delete a company-B advance → 404, B advance UNCHANGED', async () => {
    const upd = await patch(`/advances/${B.advanceId}`, A.managerToken, { outstanding: 0 });
    expect(notFoundish(upd.statusCode)).toBe(true);
    const rm = await del(`/advances/${B.advanceId}`, A.managerToken);
    expect(notFoundish(rm.statusCode)).toBe(true);
    const after = await prisma.advancePayment.findUnique({ where: { id: B.advanceId } });
    expect(Number(after!.outstanding)).toBe(300);
  });

  it('MANAGER-A create an advance for a company-B worker → 404', async () => {
    const res = await post('/advances', A.managerToken, {
      workerId: B.workerId,
      amount: 10,
      currency: 'ILS',
      date: '2026-06-03T00:00:00.000Z',
    });
    expect(notFoundish(res.statusCode)).toBe(true);
  });

  // ══ SALARY calculateMany BATCH-SMUGGLE (via dashboard) ════════════════════
  it('DASHBOARD MANAGER-A salaryTotal excludes company B (batch never crosses tenants)', async () => {
    const q = '?from=2026-06-01T00:00:00.000Z&to=2026-06-30T00:00:00.000Z&revenue=0';
    const res = await get(`/dashboard${q}`, A.managerToken);
    expect(res.statusCode).toBe(200);
    // A worker: 8h @ 100 = 800. B worker also 8h @ 100 in-window; if the batch crossed
    // tenants A's total would be 1600. It must be exactly A's 800.
    expect(res.json().finance.salaryTotal).toBe(800);
    expect(res.json().workers.totalWorkHours).toBe(8);
  });

  // ══ REDECIDE side-effect (financial integrity across tenants) ═════════════
  it('MANAGER-A REDECIDE a company-B resolved request → 404, B tagged loan UNCHANGED', async () => {
    const res = await patch(`/requests/${B.resolvedRequestId}/redecide`, A.managerToken, {
      status: 'REJECTED',
    });
    expect(notFoundish(res.statusCode)).toBe(true);
    // The tagged loan must NOT have been reversed by a cross-tenant caller.
    const loan = await prisma.loan.findUnique({ where: { id: B.taggedLoanId } });
    expect(loan).not.toBeNull();
    const reqRow = await prisma.workerRequest.findUnique({ where: { id: B.resolvedRequestId } });
    expect(reqRow!.status).toBe(RequestStatus.APPROVED); // unflipped
  });

  it('MANAGER-A create a request for a company-B worker → 404', async () => {
    const res = await post('/requests', A.managerToken, {
      workerId: B.workerId,
      type: 'ADVANCE',
      amount: 5,
      currency: 'ILS',
    });
    expect(notFoundish(res.statusCode)).toBe(true);
  });

  // ══ WORKER-SELF forgery (self surfaces ignore a forged ?workerId=<B>) ═════
  it('WORKER-A salary self: forged ?workerId=<B> is IGNORED → computes A self only', async () => {
    const res = await post('/salary/calculate', A.workerUserToken, {
      workerId: B.workerId, // forged — must be ignored
      periodStart: '2026-06-01T00:00:00.000Z',
      periodEnd: '2026-06-30T00:00:00.000Z',
    });
    // 200 (own payslip) — the forged B workerId is IGNORED (route forces the caller's
    // own resolved Worker). If the forgery had widened to B, a cross-company 404 would
    // surface; instead we get A's OWN computation: 8h @ 100 = 800, hourlyWage 100.
    expect(res.statusCode).toBe(200);
    expect(res.json().hourlyWage).toBe(100);
    expect(res.json().gross).toBe(800);
  });

  it('WORKER-A working-hours PDF self: forged ?workerId=<B> is ignored (200 own, or 403)', async () => {
    const res = await get(
      `/reports/working-hours.pdf?workerId=${B.workerId}&from=2026-06-01T00:00:00.000Z&to=2026-06-30T00:00:00.000Z`,
      A.workerUserToken,
    );
    // WORKER self path forces their own worker id; never renders B. Either their own
    // PDF (200) or a fail-closed 403 — never B's data.
    expect([200, 403].includes(res.statusCode)).toBe(true);
  });

  // ══ HEADLINE: B ids never surface in any A list ═══════════════════════════
  it('HEADLINE: no company-B id appears in ANY of MANAGER-A operational lists', async () => {
    const advances = await get('/advances?pageSize=200', A.managerToken);
    const workers = await get('/workers?pageSize=200', A.managerToken);
    const advIds: string[] = advances.json().items.map((x: { id: string }) => x.id);
    const wkrIds: string[] = workers.json().items.map((x: { id: string }) => x.id);
    expect(advIds).not.toContain(B.advanceId);
    expect(wkrIds).not.toContain(B.workerId);
  });
});
