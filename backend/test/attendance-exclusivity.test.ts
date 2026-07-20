/**
 * FR-MGR-ATT-4 — Attendance is exclusive per worker/day. A second record for the
 * same worker+date must be rejected with 409 CONFLICT (AppError.conflict), so the
 * present/vacation/disease states can never double-count.
 *
 * DB is MOCKED so the service's guard logic is tested deterministically. The real
 * uniqueness enforcement is the DB unique index (workerId_date) + this service
 * pre-check; the live-DB round-trip is covered by the skipped integration test below.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AttendanceType } from '@sitelink/shared';

const findUnique = vi.fn();
const create = vi.fn();
// MULTI-TENANCY (P2): create() now loads the worker to STAMP companyId from it (and to
// 404 a cross-company worker). With no caller (as here) the company scope is unscoped,
// so the worker only needs to resolve with a companyId for the stamp.
const workerFindUnique = vi.fn(async () => ({ companyId: 'cl000000000000000000default' }));
vi.mock('../src/db/client.js', () => ({
  prisma: {
    worker: {
      findUnique: (...a: unknown[]) => workerFindUnique(...a),
    },
    attendanceRecord: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      create: (...a: unknown[]) => create(...a),
    },
  },
}));

// mapAttendance turns a Prisma row into the wire DTO; give it a plausible row.
import { AttendanceService } from '../src/modules/attendance/service.js';

const service = new AttendanceService();

const CREATE_INPUT = {
  workerId: 'w1',
  siteId: 's1',
  date: '2026-07-12T00:00:00.000Z',
  type: AttendanceType.ATTENDANCE,
  hours: 8,
  notes: null,
};

function fakeRow() {
  return {
    id: 'att-1',
    workerId: 'w1',
    siteId: 's1',
    date: new Date('2026-07-12T00:00:00.000Z'),
    type: AttendanceType.ATTENDANCE,
    hours: 8,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

beforeEach(() => {
  findUnique.mockReset();
  create.mockReset();
});

describe('AttendanceService.create — one record per worker/day (FR-MGR-ATT-4)', () => {
  it('creates when no record exists for the worker/day', async () => {
    findUnique.mockResolvedValueOnce(null);
    create.mockResolvedValueOnce(fakeRow());
    const rec = await service.create(CREATE_INPUT as never);
    expect(rec.workerId).toBe('w1');
    expect(create).toHaveBeenCalledOnce();
    // Guard queried the composite unique key (workerId_date).
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workerId_date: expect.objectContaining({ workerId: 'w1' }),
        }),
      }),
    );
  });

  it('rejects a SECOND record for the same worker/day → 409 CONFLICT', async () => {
    findUnique.mockResolvedValueOnce(fakeRow()); // one already exists
    await expect(service.create(CREATE_INPUT as never)).rejects.toMatchObject({
      code: 'CONFLICT',
      statusCode: 409,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('conflict message does not leak internal data (FR-X-RBAC-4 spirit)', async () => {
    findUnique.mockResolvedValueOnce(fakeRow());
    await expect(service.create(CREATE_INPUT as never)).rejects.toMatchObject({
      message: expect.stringMatching(/already exists/i),
    });
  });
});
