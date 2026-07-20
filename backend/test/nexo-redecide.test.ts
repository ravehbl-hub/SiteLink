/**
 * NEXO adversarial audit — PATCH /requests/:id/redecide.
 * Covers the two gaps NOT proven by Servio's phase05-stageB FR-REQ-REDECIDE block:
 *   - CHECK 2b: cross-request scoping — flipping request A must NOT touch request B's
 *     tagged rows (reversal is WHERE requestId=A only; no worker/amount fallback).
 *   - CHECK 7:  concurrency / TOCTOU — two simultaneous REJECTED→APPROVED redecides on
 *     the SAME request. The status precondition is read OUTSIDE the $transaction and the
 *     in-txn flip is unconditional (no status guard in the UPDATE WHERE). Under READ
 *     COMMITTED (Prisma default) this is a lost-update: both can re-apply → DOUBLE tagged
 *     Loan. This test DEMONSTRATES the double-apply (adversarial: it asserts the DEFECT so
 *     the audit records the actual live behavior; see report for the fix rec).
 *
 * Live-DB, sandbox-disabled, --env-file=.env. Self-cleans all rows it creates.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import type { FastifyInstance } from 'fastify';
import { Role, RequestType, RequestStatus } from '@sitelink/shared';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { prisma } from '../src/db/client.js';

const SECRET = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET);
async function signFor(sub: string): Promise<string> {
  return new SignJWT({ aud: 'authenticated', role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(SECRET);
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

let app: FastifyInstance;
let mgrToken: string;
let mgrUserId: string;
const MGR_AUTH = `nexo-mgr-${randomUUID()}`;
const WORKER_ID = 'seed-worker-02'; // existing seed worker (reused, not mutated destructively)

const createdRequestIds: string[] = [];

beforeAll(async () => {
  app = await buildApp(loadConfig());
  await app.ready();
  const mgr = await prisma.user.upsert({
    where: { email: 'nexo-redecide-mgr@sitelink.test' },
    update: { role: Role.MANAGER, isLockedOut: false, authUserId: MGR_AUTH },
    create: {
      authUserId: MGR_AUTH,
      companyId: 'cl000000000000000000default',
      role: Role.MANAGER,
      fullName: 'Nexo Redecide Manager',
      email: 'nexo-redecide-mgr@sitelink.test',
    },
  });
  mgrUserId = mgr.id;
  mgrToken = await signFor(MGR_AUTH);
}, 60_000);

afterAll(async () => {
  for (const id of createdRequestIds) {
    await prisma.loan.deleteMany({ where: { requestId: id } }).catch(() => undefined);
    await prisma.advancePayment.deleteMany({ where: { requestId: id } }).catch(() => undefined);
    await prisma.attendanceRecord.deleteMany({ where: { requestId: id } }).catch(() => undefined);
    await prisma.workerRequest.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.user.delete({ where: { id: mgrUserId } }).catch(() => undefined);
  await app.close();
  await prisma.$disconnect();
}, 60_000);

async function createLoanReq(amount: number): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/requests',
    headers: auth(mgrToken),
    payload: { workerId: WORKER_ID, type: RequestType.LOAN, amount, currency: 'ILS' },
  });
  expect(res.statusCode).toBe(201);
  const id = res.json().id;
  createdRequestIds.push(id);
  return id;
}
async function approve(id: string): Promise<void> {
  const r = await app.inject({
    method: 'PATCH',
    url: `/api/v1/requests/${id}/approve`,
    headers: auth(mgrToken),
  });
  expect(r.statusCode).toBe(200);
}
function redecide(id: string, status: string) {
  return app.inject({
    method: 'PATCH',
    url: `/api/v1/requests/${id}/redecide`,
    headers: auth(mgrToken),
    payload: { status },
  });
}

describe('NEXO redecide — cross-request scoping (CHECK 2b)', () => {
  it('flipping request A does NOT touch request B tagged rows (same worker+amount)', async () => {
    const a = await createLoanReq(1234);
    const b = await createLoanReq(1234); // identical worker + amount, distinct request
    await approve(a);
    await approve(b);
    expect(await prisma.loan.count({ where: { requestId: a } })).toBe(1);
    expect(await prisma.loan.count({ where: { requestId: b } })).toBe(1);

    // Reject-flip A → only A's tagged loan is removed; B's survives untouched.
    const res = await redecide(a, RequestStatus.REJECTED);
    expect(res.statusCode).toBe(200);
    expect(await prisma.loan.count({ where: { requestId: a } })).toBe(0);
    expect(await prisma.loan.count({ where: { requestId: b } })).toBe(1); // B untouched
  });
});

describe('NEXO redecide — concurrency / TOCTOU (CHECK 7)', () => {
  // NOTE ON MEASUREMENT: Fastify `app.inject` processes injected requests SEQUENTIALLY
  // in-process, which MASKS the race (the 2nd request's findUnique runs after the 1st
  // txn already committed → a clean [200,409]). To exercise the ACTUAL DB-level overlap
  // that a multi-request / multi-instance deployment hits, we call the SERVICE directly
  // with two genuinely-overlapping promises. That path reproduces the double-apply 100%.
  it('FIXED: two genuinely-concurrent REJECTED→APPROVED re-applies yield EXACTLY ONE loan', async () => {
    const { RequestsService } = await import('../src/modules/requests/service.js');
    const svc = new RequestsService();

    const req = await prisma.workerRequest.create({
      data: {
        workerId: WORKER_ID,
        companyId: 'cl000000000000000000default',
        type: RequestType.LOAN,
        amount: 4321,
        currency: 'ILS',
        status: RequestStatus.REJECTED,
        resolvedById: mgrUserId,
      },
    });
    createdRequestIds.push(req.id);

    const [a, b] = await Promise.allSettled([
      svc.redecide(req.id, { status: RequestStatus.APPROVED }, mgrUserId),
      svc.redecide(req.id, { status: RequestStatus.APPROVED }, mgrUserId),
    ]);
    const loanCount = await prisma.loan.count({ where: { requestId: req.id } });
    console.log(
      `[NEXO CHECK7] service-level concurrent re-approve: outcomes=${a.status},${b.status} tagged loans=${loanCount}`,
    );

    // FIX VERIFIED: the compare-and-swap guard (conditional updateMany WHERE {id,status}
    // FIRST, then effect only on flipped.count===1) makes the second overlapping txn match
    // 0 rows → 409 'Request state changed concurrently' → its applyApprovalEffect never runs
    // and its txn rolls back. Net: EXACTLY ONE tagged loan, never two (no double-spend).
    expect(loanCount).toBe(1);

    // Exactly one call wins (fulfilled) and the loser rejects with a 409-mapped AppError.
    const fulfilled = [a, b].filter((r) => r.status === 'fulfilled');
    const rejected = [a, b].filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    const err = (rejected[0] as PromiseRejectedResult).reason as {
      statusCode?: number;
      message?: string;
    };
    expect(err?.statusCode).toBe(409);
    expect(String(err?.message)).toMatch(/state changed concurrently/i);
  });
});
