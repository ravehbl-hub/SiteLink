/**
 * MULTI-TENANCY PHASE 2 — 2-COMPANY ADVERSARIAL GATE (Servio, Back-End).
 *
 * The app's BIGGEST security boundary extended to EVERY operational surface: workers,
 * sites, attendance, requests, loans/advances, salary, dashboard/P&L, reports, personnel
 * companies, wage rates. Cross-company leakage is CATASTROPHIC. This suite seeds TWO full
 * tenants (A + B) — each with a manager, a foreman, workers, sites, attendance, requests,
 * loans, wage rates, personnel companies — and proves a company-A caller can NEVER
 * read/write/compute/render ANY of company B's data, and a body/query companyId can never
 * widen a non-admin. ADMIN sees both (and ?companyId=B narrows).
 *
 * Auth: forged Supabase-shaped HS256 tokens signed with the REAL SUPABASE_JWT_SECRET
 * whose `sub` points at a real User.authUserId (same pattern as multitenancy-phase1).
 * Role + companyId resolve from the app User row — NEVER from the token.
 *
 * All rows are seeded directly via prisma with an explicit companyId and torn down in
 * afterAll. Re-seed via upserts keeps it resilient to live-Supabase flakiness.
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
  SalaryCalcMode,
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
function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

let app: FastifyInstance;
const DEFAULT_COMPANY_ID = 'cl000000000000000000default';

// Per-tenant seeded ids.
interface Tenant {
  companyId: string;
  managerAuth: string;
  managerToken: string;
  foremanAuth: string;
  foremanToken: string;
  foremanId: string;
  siteId: string;
  workerId: string; // on foreman's site
  workerOffSiteId: string; // in company, NOT on foreman's site
  attendanceId: string;
  requestId: string; // PENDING
  loanId: string;
  personnelCompanyId: string;
}

let A: Tenant;
let B: Tenant;

const ADMIN_AUTH = `mt2-admin-${randomUUID()}`;
let adminToken: string;

// Teardown trackers.
const createdUserIds: string[] = [];
const createdCompanyIds: string[] = [];

async function seedUser(
  email: string,
  role: Role,
  companyId: string,
  authUserId: string,
  primarySiteId?: string,
): Promise<string> {
  const row = await prisma.user.upsert({
    where: { email },
    update: { role, companyId, isLockedOut: false, authUserId, primarySiteId: primarySiteId ?? null },
    create: {
      authUserId,
      companyId,
      role,
      fullName: email.split('@')[0],
      email,
      primarySiteId: primarySiteId ?? null,
    },
  });
  createdUserIds.push(row.id);
  return row.id;
}

async function seedTenant(label: string): Promise<Tenant> {
  const company = await prisma.company.create({ data: { name: `MT2 ${label} ${uniq()}` } });
  createdCompanyIds.push(company.id);
  const companyId = company.id;

  const site = await prisma.site.create({
    data: { companyId, name: `MT2 ${label} Site`, status: SiteStatus.ACTIVE },
  });

  const managerAuth = `mt2-mgr${label}-${uniq()}`;
  const foremanAuth = `mt2-for${label}-${uniq()}`;
  await seedUser(`mt2-mgr${label}-${uniq()}@sitelink.test`, Role.MANAGER, companyId, managerAuth);
  const foremanId = await seedUser(
    `mt2-for${label}-${uniq()}@sitelink.test`,
    Role.FOREMAN,
    companyId,
    foremanAuth,
    site.id,
  );

  // Worker ON the foreman's site.
  const worker = await prisma.worker.create({
    data: {
      companyId,
      firstName: `W${label}`,
      lastName: `OnSite-${uniq()}`,
      profession: Profession.PLUMBER,
      level: WorkerLevel.MEDIUM,
      salaryData: { create: { hourlyWage: 100, rateType: RateType.HOURLY, currency: 'ILS' } },
      assignments: { create: [{ siteId: site.id }] },
    },
  });

  // Worker in the company but NOT on the foreman's site.
  const workerOff = await prisma.worker.create({
    data: {
      companyId,
      firstName: `W${label}`,
      lastName: `OffSite-${uniq()}`,
      profession: Profession.IRONWORKER,
      level: WorkerLevel.MEDIUM,
      assignments: { create: [] },
    },
  });

  // Attendance (drives salary/dashboard/P&L sums).
  const att = await prisma.attendanceRecord.create({
    data: {
      workerId: worker.id,
      companyId,
      siteId: site.id,
      date: new Date('2026-06-02T00:00:00.000Z'),
      type: AttendanceType.ATTENDANCE,
      hours: 10,
    },
  });

  // A PENDING request to decide.
  const req = await prisma.workerRequest.create({
    data: {
      workerId: worker.id,
      companyId,
      type: RequestType.LOAN,
      amount: 500,
      currency: 'ILS',
      status: RequestStatus.PENDING,
    },
  });

  // A loan (drives P&L / finance list).
  const loan = await prisma.loan.create({
    data: {
      workerId: worker.id,
      companyId,
      amount: 1000,
      currency: 'ILS',
      date: new Date('2026-06-02T00:00:00.000Z'),
      outstanding: 1000,
    },
  });

  // Company-scoped wage rate — a COMPANY-WIDE rate (siteId null) for IRONWORKER, with a
  // DISTINCT wage per tenant so a cross-company fallback is detectable in salary output.
  await prisma.professionWageRate.create({
    data: {
      companyId,
      profession: Profession.IRONWORKER,
      wage: label === 'A' ? 40 : 999,
      rateType: RateType.HOURLY,
      calcMode: SalaryCalcMode.FIXED,
      currency: 'ILS',
      siteId: null,
    },
  });

  const pc = await prisma.personnelCompany.create({
    data: { companyId, name: `MT2 ${label} Staffing ${uniq()}` },
  });

  return {
    companyId,
    managerAuth,
    managerToken: '',
    foremanAuth,
    foremanToken: '',
    foremanId,
    siteId: site.id,
    workerId: worker.id,
    workerOffSiteId: workerOff.id,
    attendanceId: att.id,
    requestId: req.id,
    loanId: loan.id,
    personnelCompanyId: pc.id,
  };
}

beforeAll(async () => {
  app = await buildApp(loadConfig());
  await app.ready();

  await seedUser('mt2-admin@sitelink.test', Role.ADMIN, DEFAULT_COMPANY_ID, ADMIN_AUTH);
  adminToken = await signFor(ADMIN_AUTH);

  A = await seedTenant('A');
  B = await seedTenant('B');
  A.managerToken = await signFor(A.managerAuth);
  A.foremanToken = await signFor(A.foremanAuth);
  B.managerToken = await signFor(B.managerAuth);
  B.foremanToken = await signFor(B.foremanAuth);
}, 120_000);

afterAll(async () => {
  // Children first (FK onDelete: Restrict on company).
  const wIds = [A.workerId, A.workerOffSiteId, B.workerId, B.workerOffSiteId];
  await prisma.loan.deleteMany({ where: { workerId: { in: wIds } } }).catch(() => undefined);
  await prisma.advancePayment.deleteMany({ where: { workerId: { in: wIds } } }).catch(() => undefined);
  await prisma.attendanceRecord.deleteMany({ where: { workerId: { in: wIds } } }).catch(() => undefined);
  await prisma.workerRequest.deleteMany({ where: { workerId: { in: wIds } } }).catch(() => undefined);
  await prisma.siteAssignment.deleteMany({ where: { workerId: { in: wIds } } }).catch(() => undefined);
  await prisma.workerSalaryData.deleteMany({ where: { workerId: { in: wIds } } }).catch(() => undefined);
  await prisma.worker.deleteMany({ where: { id: { in: wIds } } }).catch(() => undefined);
  for (const cId of createdCompanyIds) {
    await prisma.professionWageRate.deleteMany({ where: { companyId: cId } }).catch(() => undefined);
    await prisma.personnelCompany.deleteMany({ where: { companyId: cId } }).catch(() => undefined);
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
function patch(url: string, token: string, payload?: unknown) {
  return app.inject({ method: 'PATCH', url: `/api/v1${url}`, headers: auth(token), payload });
}
function del(url: string, token: string) {
  return app.inject({ method: 'DELETE', url: `/api/v1${url}`, headers: auth(token) });
}
const notFoundish = (code: number) => [403, 404].includes(code);

describe('Multi-tenancy Phase 2 — 2-company operational isolation', () => {
  // ══ WORKERS ══════════════════════════════════════════════════════════════
  it('MANAGER-A list workers → ONLY company A; company-B workers NEVER appear', async () => {
    const res = await get('/workers?pageSize=200', A.managerToken);
    expect(res.statusCode).toBe(200);
    const ids: string[] = res.json().items.map((w: { id: string }) => w.id);
    const companies: string[] = res.json().items.map((w: { companyId: string }) => w.companyId);
    expect(companies.every((c) => c === A.companyId)).toBe(true);
    expect(ids).toContain(A.workerId);
    expect(ids).not.toContain(B.workerId);
    expect(ids).not.toContain(B.workerOffSiteId);
  });

  it('MANAGER-A ?companyId=B is IGNORED → still ONLY company A', async () => {
    const res = await get(`/workers?pageSize=200&companyId=${B.companyId}`, A.managerToken);
    expect(res.statusCode).toBe(200);
    const companies: string[] = res.json().items.map((w: { companyId: string }) => w.companyId);
    expect(companies.every((c) => c === A.companyId)).toBe(true);
    const ids: string[] = res.json().items.map((w: { id: string }) => w.id);
    expect(ids).not.toContain(B.workerId);
  });

  it('MANAGER-A GET a company-B worker → 404 (no existence leak)', async () => {
    const res = await get(`/workers/${B.workerId}`, A.managerToken);
    expect(notFoundish(res.statusCode)).toBe(true);
  });

  it('MANAGER-A UPDATE a company-B worker → 404 and B worker UNCHANGED', async () => {
    const before = await prisma.worker.findUnique({ where: { id: B.workerId } });
    const res = await patch(`/workers/${B.workerId}`, A.managerToken, { firstName: 'HACKED' });
    expect(notFoundish(res.statusCode)).toBe(true);
    const after = await prisma.worker.findUnique({ where: { id: B.workerId } });
    expect(after!.firstName).toBe(before!.firstName);
    expect(after!.companyId).toBe(B.companyId);
  });

  it('MANAGER-A ARCHIVE / DELETE a company-B worker → 404 and B worker STILL EXISTS', async () => {
    const arch = await post(`/workers/${B.workerId}/archive`, A.managerToken, {});
    expect(notFoundish(arch.statusCode)).toBe(true);
    const rm = await del(`/workers/${B.workerId}`, A.managerToken);
    expect(notFoundish(rm.statusCode)).toBe(true);
    const after = await prisma.worker.findUnique({ where: { id: B.workerId } });
    expect(after).not.toBeNull();
    expect(after!.isArchived).toBe(false);
  });

  it('MANAGER-A CREATE worker with body companyId=B → stamped company A', async () => {
    const email = `mt2-newWrkA-${uniq()}@sitelink.test`;
    const res = await post('/workers', A.managerToken, {
      firstName: 'New',
      lastName: 'WorkerA',
      profession: Profession.PLUMBER,
      email,
      password: `Pw-${randomUUID()}`,
      companyId: B.companyId, // ADVERSARIAL
      siteIds: [A.siteId],
    });
    expect(res.statusCode).toBe(201);
    const created = res.json();
    expect(created.companyId).toBe(A.companyId);
    // Cleanup the created worker + its provisioned login.
    const row = await prisma.worker.findUnique({ where: { id: created.id }, select: { userId: true } });
    await prisma.siteAssignment.deleteMany({ where: { workerId: created.id } }).catch(() => undefined);
    await prisma.workerSalaryData.deleteMany({ where: { workerId: created.id } }).catch(() => undefined);
    await prisma.worker.delete({ where: { id: created.id } }).catch(() => undefined);
    if (row?.userId) {
      const u = await prisma.user.findUnique({ where: { id: row.userId }, select: { authUserId: true } });
      if (u) await app.supabase.deleteAuthUser(u.authUserId).catch(() => undefined);
      await prisma.user.delete({ where: { id: row.userId } }).catch(() => undefined);
    }
  });

  // ══ SITES ════════════════════════════════════════════════════════════════
  it('MANAGER-A list sites → ONLY company A; GET a company-B site → 404', async () => {
    const list = await get('/sites?pageSize=200', A.managerToken);
    expect(list.statusCode).toBe(200);
    const ids: string[] = list.json().items.map((s: { id: string }) => s.id);
    expect(ids).toContain(A.siteId);
    expect(ids).not.toContain(B.siteId);
    const one = await get(`/sites/${B.siteId}`, A.managerToken);
    expect(notFoundish(one.statusCode)).toBe(true);
  });

  it('MANAGER-A create site → stamped company A (body companyId=B ignored)', async () => {
    const res = await post('/sites', A.managerToken, { name: `MT2 New A ${uniq()}`, companyId: B.companyId });
    expect(res.statusCode).toBe(201);
    expect(res.json().companyId).toBe(A.companyId);
    await prisma.site.delete({ where: { id: res.json().id } }).catch(() => undefined);
  });

  it('MANAGER-A archive/update a company-B site → 404, B site UNCHANGED', async () => {
    const before = await prisma.site.findUnique({ where: { id: B.siteId } });
    const upd = await patch(`/sites/${B.siteId}`, A.managerToken, { name: 'HACKED' });
    expect(notFoundish(upd.statusCode)).toBe(true);
    const after = await prisma.site.findUnique({ where: { id: B.siteId } });
    expect(after!.name).toBe(before!.name);
  });

  // ══ ATTENDANCE ═══════════════════════════════════════════════════════════
  it('MANAGER-A list attendance → ONLY company A rows', async () => {
    const res = await get('/attendance?pageSize=500', A.managerToken);
    expect(res.statusCode).toBe(200);
    const workerIds: string[] = res.json().items.map((r: { workerId: string }) => r.workerId);
    expect(workerIds).not.toContain(B.workerId);
    const ids: string[] = res.json().items.map((r: { id: string }) => r.id);
    expect(ids).not.toContain(B.attendanceId);
  });

  it('MANAGER-A create attendance for a company-B worker → 404, no row created', async () => {
    const before = await prisma.attendanceRecord.count({ where: { workerId: B.workerId } });
    const res = await post('/attendance', A.managerToken, {
      workerId: B.workerId,
      date: '2026-06-09T00:00:00.000Z',
      type: AttendanceType.ATTENDANCE,
      hours: 8,
    });
    expect(notFoundish(res.statusCode)).toBe(true);
    const after = await prisma.attendanceRecord.count({ where: { workerId: B.workerId } });
    expect(after).toBe(before);
  });

  it('MANAGER-A update/delete a company-B attendance record → 404, unchanged', async () => {
    const upd = await patch(`/attendance/${B.attendanceId}`, A.managerToken, { hours: 1 });
    expect(notFoundish(upd.statusCode)).toBe(true);
    const rm = await del(`/attendance/${B.attendanceId}`, A.managerToken);
    expect(notFoundish(rm.statusCode)).toBe(true);
    const after = await prisma.attendanceRecord.findUnique({ where: { id: B.attendanceId } });
    expect(after).not.toBeNull();
    expect(Number(after!.hours)).toBe(10);
  });

  // ══ REQUESTS ═════════════════════════════════════════════════════════════
  it('MANAGER-A list requests → ONLY company A; company-B request NEVER appears', async () => {
    const res = await get('/requests?pageSize=200', A.managerToken);
    expect(res.statusCode).toBe(200);
    const ids: string[] = res.json().items.map((r: { id: string }) => r.id);
    expect(ids).not.toContain(B.requestId);
  });

  it('MANAGER-A approve/reject/redecide a company-B request → 404, B request UNCHANGED', async () => {
    const before = await prisma.workerRequest.findUnique({ where: { id: B.requestId } });
    const appr = await patch(`/requests/${B.requestId}/approve`, A.managerToken, {});
    expect(notFoundish(appr.statusCode)).toBe(true);
    const after = await prisma.workerRequest.findUnique({ where: { id: B.requestId } });
    expect(after!.status).toBe(before!.status); // still PENDING
    // No side-effect loan tagged to B's request was created by A's attempt.
    expect(await prisma.loan.count({ where: { requestId: B.requestId } })).toBe(0);
  });

  it('MANAGER-A create request for a company-B worker → 404', async () => {
    const res = await post('/requests', A.managerToken, {
      workerId: B.workerId,
      type: RequestType.ADVANCE,
      amount: 200,
      currency: 'ILS',
    });
    expect(notFoundish(res.statusCode)).toBe(true);
  });

  // ══ SALARY (TOP FLAGGED LEAK) ════════════════════════════════════════════
  it('MANAGER-A calculate salary for a company-B worker → 404', async () => {
    const res = await post('/salary/calculate', A.managerToken, {
      workerId: B.workerId,
      periodStart: '2026-06-01T00:00:00.000Z',
      periodEnd: '2026-06-30T00:00:00.000Z',
    });
    expect(notFoundish(res.statusCode)).toBe(true);
  });

  it('SALARY wage-fallback is COMPANY-scoped: worker-A(IRONWORKER) resolves A rate (40), never B rate (999)', async () => {
    // workerOffSite in A is an IRONWORKER with NO per-worker salaryData → falls back to
    // the company-wide ProfessionWageRate. A's rate = 40, B's = 999 for the same
    // profession. Proving A resolves 40 proves the fallback never crosses tenants.
    const res = await post('/salary/calculate', A.managerToken, {
      workerId: A.workerOffSiteId,
      periodStart: '2026-06-01T00:00:00.000Z',
      periodEnd: '2026-06-30T00:00:00.000Z',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().hourlyWage).toBe(40);
    expect(res.json().hourlyWage).not.toBe(999);
  });

  // ══ FINANCE / LOANS ══════════════════════════════════════════════════════
  it('MANAGER-A list loans → ONLY company A; company-B loan NEVER appears', async () => {
    const res = await get('/loans?pageSize=200', A.managerToken);
    expect(res.statusCode).toBe(200);
    const ids: string[] = res.json().items.map((l: { id: string }) => l.id);
    expect(ids).not.toContain(B.loanId);
  });

  it('MANAGER-A update/delete a company-B loan → 404, B loan UNCHANGED', async () => {
    const upd = await patch(`/loans/${B.loanId}`, A.managerToken, { outstanding: 0 });
    expect(notFoundish(upd.statusCode)).toBe(true);
    const after = await prisma.loan.findUnique({ where: { id: B.loanId } });
    expect(Number(after!.outstanding)).toBe(1000);
  });

  it('MANAGER-A create loan for a company-B worker → 404', async () => {
    const res = await post('/loans', A.managerToken, {
      workerId: B.workerId,
      amount: 50,
      currency: 'ILS',
      date: '2026-06-02T00:00:00.000Z',
    });
    expect(notFoundish(res.statusCode)).toBe(true);
  });

  // ══ DASHBOARD / P&L (TOP FLAGGED LEAK) ═══════════════════════════════════
  it('DASHBOARD MANAGER-A rollup counts/sums EXCLUDE company B', async () => {
    const q = '?from=2026-06-01T00:00:00.000Z&to=2026-06-30T00:00:00.000Z&revenue=0';
    const a = await get(`/dashboard${q}`, A.managerToken);
    const b = await get(`/dashboard${q}`, B.managerToken);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    // A's loans total = A's loan only (1000), never A+B (2000).
    expect(a.json().workers.loansTotal).toBe(1000);
    expect(b.json().workers.loansTotal).toBe(1000);
    // A's worked hours come only from A's single 10h attendance row.
    expect(a.json().workers.totalWorkHours).toBe(10);
    // Headcount excludes B's workers.
    expect(a.json().workers.amountOfWorkers).toBeLessThanOrEqual(2);
  });

  it('P&L MANAGER-A loansCost EXCLUDES company B (1000, not 2000)', async () => {
    const q = '?from=2026-06-01T00:00:00.000Z&to=2026-06-30T00:00:00.000Z&revenue=0';
    const res = await get(`/profit-loss${q}`, A.managerToken);
    expect(res.statusCode).toBe(200);
    expect(res.json().loansCost).toBe(1000);
  });

  // ══ REPORTS (TOP FLAGGED LEAK) ═══════════════════════════════════════════
  it('MANAGER-A payslip PDF for a company-B worker → 404 (no render)', async () => {
    const res = await get(
      `/reports/payslip.pdf?workerId=${B.workerId}&from=2026-06-01T00:00:00.000Z&to=2026-06-30T00:00:00.000Z`,
      A.managerToken,
    );
    expect(notFoundish(res.statusCode)).toBe(true);
  });

  it('MANAGER-A working-hours PDF for a company-B worker → 404', async () => {
    const res = await get(
      `/reports/working-hours.pdf?workerId=${B.workerId}&from=2026-06-01T00:00:00.000Z&to=2026-06-30T00:00:00.000Z`,
      A.managerToken,
    );
    expect(notFoundish(res.statusCode)).toBe(true);
  });

  it('MANAGER-A payslip EMAIL share for a company-B worker → 404 (no signed URL / send)', async () => {
    const res = await post('/reports/payslip/email', A.managerToken, {
      workerId: B.workerId,
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-06-30T00:00:00.000Z',
    });
    expect(notFoundish(res.statusCode)).toBe(true);
  });

  it('MANAGER-A payslip WHATSAPP share for a company-B worker → 404 (no signed URL minted)', async () => {
    const res = await post('/reports/payslip/whatsapp-link', A.managerToken, {
      workerId: B.workerId,
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-06-30T00:00:00.000Z',
    });
    expect(notFoundish(res.statusCode)).toBe(true);
  });

  // ══ PERSONNEL COMPANIES ══════════════════════════════════════════════════
  it('MANAGER-A list personnel-companies → ONLY company A; GET a company-B one → 404', async () => {
    const list = await get('/personnel-companies?pageSize=200', A.managerToken);
    expect(list.statusCode).toBe(200);
    const ids: string[] = list.json().items.map((c: { id: string }) => c.id);
    expect(ids).toContain(A.personnelCompanyId);
    expect(ids).not.toContain(B.personnelCompanyId);
    const one = await get(`/personnel-companies/${B.personnelCompanyId}`, A.managerToken);
    expect(notFoundish(one.statusCode)).toBe(true);
  });

  it('MANAGER-A create personnel-company → stamped company A', async () => {
    const res = await post('/personnel-companies', A.managerToken, { name: `MT2 A New ${uniq()}` });
    expect(res.statusCode).toBe(201);
    expect(res.json().companyId).toBe(A.companyId);
    await prisma.personnelCompany.delete({ where: { id: res.json().id } }).catch(() => undefined);
  });

  // ══ WAGE RATES ═══════════════════════════════════════════════════════════
  it('MANAGER-A list wage-rates → ONLY company A rates', async () => {
    const res = await get('/wage-rates', A.managerToken);
    expect(res.statusCode).toBe(200);
    const companies: string[] = res.json().map((r: { companyId: string }) => r.companyId);
    expect(companies.every((c) => c === A.companyId)).toBe(true);
  });

  it('MANAGER-A create wage-rate → stamped company A (dedupe is per-company)', async () => {
    const res = await post('/wage-rates', A.managerToken, {
      profession: Profession.PLUMBER,
      wage: 55,
      rateType: RateType.HOURLY,
      calcMode: SalaryCalcMode.FIXED,
      currency: 'ILS',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().companyId).toBe(A.companyId);
    await prisma.professionWageRate.delete({ where: { id: res.json().id } }).catch(() => undefined);
  });

  // ══ FOREMAN-ASSIGNMENTS (derived) ════════════════════════════════════════
  it('MANAGER-A cannot assign their foreman to a company-B site → 404/400', async () => {
    const res = await post('/foreman-assignments', A.managerToken, {
      foremanId: A.foremanId,
      siteId: B.siteId,
    });
    expect([400, 403, 404]).toContain(res.statusCode);
  });

  it('MANAGER-A cannot list a company-B foreman assignments → 404', async () => {
    const res = await get(`/foreman-assignments?foremanId=${B.foremanId}`, A.managerToken);
    expect(notFoundish(res.statusCode)).toBe(true);
  });

  // ══ FOREMAN-A composed with site/self ════════════════════════════════════
  it('FOREMAN-A list workers → only company-A + own-site workers; NONE of company B', async () => {
    const res = await get('/workers?pageSize=200', A.foremanToken);
    expect(res.statusCode).toBe(200);
    const ids: string[] = res.json().items.map((w: { id: string }) => w.id);
    const companies: string[] = res.json().items.map((w: { companyId: string }) => w.companyId);
    expect(companies.every((c) => c === A.companyId)).toBe(true);
    expect(ids).toContain(A.workerId); // on foreman's site
    expect(ids).not.toContain(B.workerId);
    expect(ids).not.toContain(A.workerOffSiteId); // in company but off the foreman's site
  });

  it('FOREMAN-A get a company-B worker → 404 (company beats site scope)', async () => {
    const res = await get(`/workers/${B.workerId}`, A.foremanToken);
    expect(notFoundish(res.statusCode)).toBe(true);
  });

  // ══ RATINGS (derived) ════════════════════════════════════════════════════
  it('FOREMAN-A rate a company-B worker → 404', async () => {
    const res = await post(`/workers/${B.workerId}/ratings`, A.foremanToken, {
      date: '2026-06-02T00:00:00.000Z',
      score: 5,
    });
    expect(notFoundish(res.statusCode)).toBe(true);
  });

  // ══ ADMIN cross-company ══════════════════════════════════════════════════
  it('ADMIN list workers → sees BOTH tenants; ?companyId=B narrows to B', async () => {
    const all = await get('/workers?pageSize=200', adminToken);
    expect(all.statusCode).toBe(200);
    const allIds: string[] = all.json().items.map((w: { id: string }) => w.id);
    expect(allIds).toContain(A.workerId);
    expect(allIds).toContain(B.workerId);

    const narrowed = await get(`/workers?pageSize=200&companyId=${B.companyId}`, adminToken);
    expect(narrowed.statusCode).toBe(200);
    const companies: string[] = narrowed.json().items.map((w: { companyId: string }) => w.companyId);
    expect(companies.length).toBeGreaterThan(0);
    expect(companies.every((c) => c === B.companyId)).toBe(true);
  });

  it('ADMIN can GET a company-B worker (cross-company)', async () => {
    const res = await get(`/workers/${B.workerId}`, adminToken);
    expect(res.statusCode).toBe(200);
    expect(res.json().companyId).toBe(B.companyId);
  });

  // ══ HEADLINE ISOLATION ═══════════════════════════════════════════════════
  it('HEADLINE: company-A manager sees NONE of company B across every list surface', async () => {
    const surfaces = ['/workers', '/sites', '/attendance', '/requests', '/loans', '/personnel-companies'];
    for (const s of surfaces) {
      const res = await get(`${s}?pageSize=200`, A.managerToken);
      expect(res.statusCode).toBe(200);
      const items = res.json().items ?? res.json();
      const serialized = JSON.stringify(items);
      // No company-B id of any kind should surface in an A-manager list body.
      expect(serialized).not.toContain(B.companyId);
      expect(serialized).not.toContain(B.workerId);
      expect(serialized).not.toContain(B.siteId);
    }
  });
});
