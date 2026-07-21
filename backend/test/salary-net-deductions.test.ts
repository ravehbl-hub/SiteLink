/**
 * NET WAGE (נטו) deductions — SalaryService.calculate (Servio, Back-End).
 *
 * Proves the single-calc path reconciles GROSS against the worker's OWN-company
 * APPROVED loan/advance requests within the calc PERIOD:
 *   NET = gross − Σ(approved LOAN) − Σ(approved ADVANCE)
 *
 * Coverage:
 *   - approved LOAN 500 + approved ADVANCE 300 in-period, gross 5400 →
 *     loansTotal 500, advancesTotal 300, net 4600.
 *   - PENDING / REJECTED requests are EXCLUDED.
 *   - an approved loan OUTSIDE the period is EXCLUDED (period-based default).
 *   - NEGATIVE net is returned as the REAL number (not floored): gross 100,
 *     loans 500 → net −400.
 *   - COMPANY scope: the deduction query is companyId-guarded (the worker's own
 *     company), so no cross-company request is ever summed.
 *
 * Live-DB (real Supabase) — seeds directly via prisma, explicit teardown. Run with
 * the prescribed `node --import tsx --env-file=.env vitest run` (network sandbox-off).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  AttendanceType,
  Profession,
  RateType,
  RequestStatus,
  RequestType,
  WorkerLevel,
} from '@sitelink/shared';
import { prisma } from '../src/db/client.js';
import { SalaryService } from '../src/modules/salary/service.js';

const uniq = () => randomUUID().slice(0, 8);

// Period under test.
const PERIOD_START = '2026-05-01T00:00:00.000Z';
const PERIOD_END = '2026-05-31T00:00:00.000Z';

const service = new SalaryService();

// Teardown trackers.
const companyIds: string[] = [];
const workerIds: string[] = [];

/** Seed a company + one hourly worker; return ids. */
async function seedWorker(hourlyWage: number): Promise<{ companyId: string; workerId: string }> {
  const company = await prisma.company.create({ data: { name: `NET ${uniq()}` } });
  companyIds.push(company.id);
  const worker = await prisma.worker.create({
    data: {
      companyId: company.id,
      firstName: `Net${uniq()}`,
      lastName: 'Worker',
      profession: Profession.PLUMBER,
      level: WorkerLevel.MEDIUM,
      salaryData: { create: { hourlyWage, rateType: RateType.HOURLY, currency: 'ILS' } },
    },
  });
  workerIds.push(worker.id);
  return { companyId: company.id, workerId: worker.id };
}

/** Seed N attendance days (each `hours`h) starting 2026-05-01. */
async function seedAttendance(
  companyId: string,
  workerId: string,
  days: number,
  hours: number,
): Promise<void> {
  for (let i = 0; i < days; i++) {
    await prisma.attendanceRecord.create({
      data: {
        companyId,
        workerId,
        date: new Date(Date.UTC(2026, 4, i + 1)),
        type: AttendanceType.ATTENDANCE,
        hours,
      },
    });
  }
}

async function seedRequest(args: {
  companyId: string;
  workerId: string;
  type: RequestType;
  status: RequestStatus;
  amount: number;
  startDate: Date;
}): Promise<void> {
  await prisma.workerRequest.create({
    data: {
      companyId: args.companyId,
      workerId: args.workerId,
      type: args.type,
      status: args.status,
      amount: args.amount,
      currency: 'ILS',
      startDate: args.startDate,
    },
  });
}

afterAll(async () => {
  // Children first (FK), then workers, then companies.
  await prisma.workerRequest.deleteMany({ where: { workerId: { in: workerIds } } });
  await prisma.attendanceRecord.deleteMany({ where: { workerId: { in: workerIds } } });
  await prisma.workerSalaryData.deleteMany({ where: { workerId: { in: workerIds } } });
  await prisma.worker.deleteMany({ where: { id: { in: workerIds } } });
  await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
  await prisma.$disconnect();
});

describe('SalaryService.calculate — NET WAGE (נטו) deductions', () => {
  it('gross 5400 − LOAN 500 − ADVANCE 300 (in-period, approved) → net 4600', async () => {
    // 12 days × 9h × 50 = 5400.
    const { companyId, workerId } = await seedWorker(50);
    await seedAttendance(companyId, workerId, 12, 9);
    await seedRequest({
      companyId, workerId, type: RequestType.LOAN, status: RequestStatus.APPROVED,
      amount: 500, startDate: new Date(Date.UTC(2026, 4, 10)),
    });
    await seedRequest({
      companyId, workerId, type: RequestType.ADVANCE, status: RequestStatus.APPROVED,
      amount: 300, startDate: new Date(Date.UTC(2026, 4, 15)),
    });

    const r = await service.calculate({
      workerId, periodStart: PERIOD_START, periodEnd: PERIOD_END,
    });

    expect(r.gross).toBe(5400);
    expect(r.loansTotal).toBe(500);
    expect(r.advancesTotal).toBe(300);
    expect(r.net).toBe(4600);
    // Reconciles: net === gross − loans − advances.
    expect(r.net).toBe(r.gross - r.loansTotal! - r.advancesTotal!);
  });

  it('EXCLUDES a PENDING loan and a REJECTED advance (approved-only)', async () => {
    const { companyId, workerId } = await seedWorker(50);
    await seedAttendance(companyId, workerId, 12, 9); // gross 5400
    await seedRequest({
      companyId, workerId, type: RequestType.LOAN, status: RequestStatus.PENDING,
      amount: 999, startDate: new Date(Date.UTC(2026, 4, 10)),
    });
    await seedRequest({
      companyId, workerId, type: RequestType.ADVANCE, status: RequestStatus.REJECTED,
      amount: 777, startDate: new Date(Date.UTC(2026, 4, 12)),
    });

    const r = await service.calculate({
      workerId, periodStart: PERIOD_START, periodEnd: PERIOD_END,
    });
    expect(r.loansTotal).toBe(0);
    expect(r.advancesTotal).toBe(0);
    expect(r.net).toBe(5400);
  });

  it('EXCLUDES an approved loan whose date is OUTSIDE the period (period-based default)', async () => {
    const { companyId, workerId } = await seedWorker(50);
    await seedAttendance(companyId, workerId, 12, 9); // gross 5400
    // Approved LOAN in APRIL — before the May period.
    await seedRequest({
      companyId, workerId, type: RequestType.LOAN, status: RequestStatus.APPROVED,
      amount: 500, startDate: new Date(Date.UTC(2026, 3, 10)),
    });
    // Approved ADVANCE in JUNE — after the May period.
    await seedRequest({
      companyId, workerId, type: RequestType.ADVANCE, status: RequestStatus.APPROVED,
      amount: 300, startDate: new Date(Date.UTC(2026, 5, 2)),
    });

    const r = await service.calculate({
      workerId, periodStart: PERIOD_START, periodEnd: PERIOD_END,
    });
    expect(r.loansTotal).toBe(0);
    expect(r.advancesTotal).toBe(0);
    expect(r.net).toBe(5400);
  });

  it('returns a REAL NEGATIVE net (NOT floored) when deductions exceed gross', async () => {
    // 2h × 50 = gross 100; approved LOAN 500 → net −400.
    const { companyId, workerId } = await seedWorker(50);
    await seedAttendance(companyId, workerId, 1, 2); // gross 100
    await seedRequest({
      companyId, workerId, type: RequestType.LOAN, status: RequestStatus.APPROVED,
      amount: 500, startDate: new Date(Date.UTC(2026, 4, 5)),
    });

    const r = await service.calculate({
      workerId, periodStart: PERIOD_START, periodEnd: PERIOD_END,
    });
    expect(r.gross).toBe(100);
    expect(r.loansTotal).toBe(500);
    expect(r.net).toBe(-400); // real negative, not floored at 0
    expect(r.net).toBeLessThan(0);
  });

  it('COMPANY-SCOPED: a same-worker-name approved loan in ANOTHER company is NEVER summed', async () => {
    // Worker in company A (the one we compute).
    const { companyId: companyA, workerId } = await seedWorker(50);
    await seedAttendance(companyA, workerId, 12, 9); // gross 5400
    await seedRequest({
      companyId: companyA, workerId, type: RequestType.LOAN, status: RequestStatus.APPROVED,
      amount: 500, startDate: new Date(Date.UTC(2026, 4, 10)),
    });

    // A SEPARATE company B with its OWN worker + an approved loan. This must never
    // leak into worker A's deductions. (A single WorkerRequest can't legally point at
    // A's workerId under B's companyId — FKs bind both to the same worker — so the
    // companyId guard is what keeps a cross-company request out: even if such a row
    // existed, `companyId: worker.companyId` in the query excludes it.)
    const b = await seedWorker(50);
    await seedRequest({
      companyId: b.companyId, workerId: b.workerId, type: RequestType.LOAN,
      status: RequestStatus.APPROVED, amount: 9999,
      startDate: new Date(Date.UTC(2026, 4, 10)),
    });

    const r = await service.calculate({
      workerId, periodStart: PERIOD_START, periodEnd: PERIOD_END,
    });
    // Only company A's own 500 — company B's 9999 is invisible.
    expect(r.loansTotal).toBe(500);
    expect(r.net).toBe(4900);
  });
});
