/**
 * FR-MGR-ATT — Clock IN/OUT + site on AttendanceRecord (editable, company-scoped).
 *
 * The manual `hours` stays the source of truth for pay; checkIn/checkOut are
 * presence/display fields that must be accepted on create, returned on read, and
 * be EDITABLE on update. Phase-2 company scoping must stay intact: a MANAGER may
 * never create/edit/read another company's record (cross-company → 404).
 *
 * DB is MOCKED so the service logic is tested deterministically (live-DB is
 * sandbox-disabled). Mirrors attendance-exclusivity.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AttendanceType } from '@sitelink/shared';

const findUnique = vi.fn();
const create = vi.fn();
const update = vi.fn();
const workerFindUnique = vi.fn(async () => ({ companyId: 'companyA' }));
// Site company for the tenancy guard on a supplied siteId (assertSiteInCompany).
// Default: the site is in companyA (same as the record) → passes.
const siteFindUnique = vi.fn(async () => ({ companyId: 'companyA' }));

vi.mock('../src/db/client.js', () => ({
  prisma: {
    worker: {
      findUnique: (...a: unknown[]) => workerFindUnique(...a),
    },
    site: {
      findUnique: (...a: unknown[]) => siteFindUnique(...a),
    },
    attendanceRecord: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      create: (...a: unknown[]) => create(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}));

import { AttendanceService } from '../src/modules/attendance/service.js';

const service = new AttendanceService();

// A MANAGER pinned to companyA (Phase-2 company scope derives from user.companyId).
const managerA = {
  id: 'u-mgr-a',
  role: 'MANAGER',
  companyId: 'companyA',
} as never;

const IN = '2026-07-12T08:00:00.000Z';
const OUT = '2026-07-12T17:00:00.000Z';

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'att-1',
    workerId: 'w1',
    companyId: 'companyA',
    siteId: 's1',
    date: new Date('2026-07-12T00:00:00.000Z'),
    type: AttendanceType.ATTENDANCE,
    checkIn: new Date(IN),
    checkOut: new Date(OUT),
    hours: 8,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

beforeEach(() => {
  findUnique.mockReset();
  create.mockReset();
  update.mockReset();
  workerFindUnique.mockClear();
  siteFindUnique.mockClear();
  siteFindUnique.mockResolvedValue({ companyId: 'companyA' });
});

describe('AttendanceService.create — clock IN/OUT + site', () => {
  it('persists + returns checkIn/checkOut/siteId/hours', async () => {
    findUnique.mockResolvedValueOnce(null); // no existing record for worker/day
    create.mockResolvedValueOnce(row());
    const rec = await service.create(
      {
        workerId: 'w1',
        siteId: 's1',
        date: '2026-07-12T00:00:00.000Z',
        type: AttendanceType.ATTENDANCE,
        checkIn: IN,
        checkOut: OUT,
        hours: 8,
        notes: null,
      } as never,
      managerA,
    );
    // Persisted with parsed Date in/out + site + hours.
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          checkIn: new Date(IN),
          checkOut: new Date(OUT),
          siteId: 's1',
          hours: 8,
        }),
      }),
    );
    // Returned DTO surfaces them (ISO strings).
    expect(rec.checkIn).toBe(IN);
    expect(rec.checkOut).toBe(OUT);
    expect(rec.siteId).toBe('s1');
    expect(rec.hours).toBe(8);
  });

  it('backward-compat: manual hours only, no in/out → persists null in/out', async () => {
    findUnique.mockResolvedValueOnce(null);
    create.mockResolvedValueOnce(row({ checkIn: null, checkOut: null }));
    const rec = await service.create(
      {
        workerId: 'w1',
        siteId: 's1',
        date: '2026-07-12T00:00:00.000Z',
        type: AttendanceType.ATTENDANCE,
        hours: 8,
        notes: null,
      } as never,
      managerA,
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ checkIn: null, checkOut: null, hours: 8 }),
      }),
    );
    expect(rec.checkIn).toBeNull();
    expect(rec.checkOut).toBeNull();
  });

  it('checkOut BEFORE checkIn → 400 VALIDATION', async () => {
    findUnique.mockResolvedValueOnce(null);
    await expect(
      service.create(
        {
          workerId: 'w1',
          siteId: 's1',
          date: '2026-07-12T00:00:00.000Z',
          type: AttendanceType.ATTENDANCE,
          checkIn: OUT, // swapped
          checkOut: IN,
          hours: 8,
        } as never,
        managerA,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(create).not.toHaveBeenCalled();
  });

  it('TENANCY: a MANAGER supplying a CROSS-COMPANY siteId → 404, no create', async () => {
    findUnique.mockResolvedValueOnce(null); // no existing record
    siteFindUnique.mockResolvedValueOnce({ companyId: 'companyB' }); // site in ANOTHER company
    await expect(
      service.create(
        {
          workerId: 'w1', // worker is companyA
          siteId: 's-companyB', // crafted cross-tenant site
          date: '2026-07-12T00:00:00.000Z',
          type: AttendanceType.ATTENDANCE,
          hours: 8,
        } as never,
        managerA,
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('AttendanceService.update — editable clock IN/OUT + site (company-scoped)', () => {
  it('edits checkIn/checkOut/siteId of an OWN-company record', async () => {
    findUnique.mockResolvedValueOnce(row()); // current, companyA
    const newIn = '2026-07-12T09:00:00.000Z';
    const newOut = '2026-07-12T18:00:00.000Z';
    update.mockResolvedValueOnce(
      row({ checkIn: new Date(newIn), checkOut: new Date(newOut), siteId: 's2' }),
    );
    const rec = await service.update(
      'att-1',
      { checkIn: newIn, checkOut: newOut, siteId: 's2' } as never,
      managerA,
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'att-1' },
        data: expect.objectContaining({
          checkIn: new Date(newIn),
          checkOut: new Date(newOut),
          siteId: 's2',
        }),
      }),
    );
    expect(rec.checkIn).toBe(newIn);
    expect(rec.checkOut).toBe(newOut);
    expect(rec.siteId).toBe('s2');
  });

  it('CROSS-COMPANY record → 404 (Phase-2 scope intact, no mutation)', async () => {
    findUnique.mockResolvedValueOnce(row({ companyId: 'companyB' })); // other tenant
    await expect(
      service.update('att-1', { checkIn: IN } as never, managerA),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(update).not.toHaveBeenCalled();
  });
});
