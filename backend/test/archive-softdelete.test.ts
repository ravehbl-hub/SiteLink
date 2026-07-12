/**
 * Archive / soft-delete behavior (FR-MGR-EMP-5/6, FR-MGR-SITE-1/3) + the worker-doc
 * storage-key traversal guard (Architecture §7a). DB + Supabase are MOCKED so the
 * service logic is verified deterministically.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const siteFindUnique = vi.fn();
const siteUpdate = vi.fn();
const siteDelete = vi.fn();
const workerFindUnique = vi.fn();
const workerUpdate = vi.fn();

vi.mock('../src/db/client.js', () => ({
  prisma: {
    site: {
      findUnique: (...a: unknown[]) => siteFindUnique(...a),
      update: (...a: unknown[]) => siteUpdate(...a),
      delete: (...a: unknown[]) => siteDelete(...a),
    },
    worker: {
      findUnique: (...a: unknown[]) => workerFindUnique(...a),
      update: (...a: unknown[]) => workerUpdate(...a),
    },
  },
}));

import { SitesService } from '../src/modules/sites/service.js';
import { WorkersService } from '../src/modules/workers/service.js';

const now = new Date();
function baseSite(over: Record<string, unknown> = {}) {
  return {
    id: 's1', name: 'Site 1', code: null, status: 'ACTIVE', address: null,
    startedAt: null, isArchived: false, archivedAt: null, createdAt: now, updatedAt: now, ...over,
  };
}
function baseWorker(over: Record<string, unknown> = {}) {
  return {
    id: 'w1', firstName: 'A', lastName: 'B', country: null, address: null,
    profession: 'PLUMBER', level: 'GOOD', qualityOfWorks: null, phone: null, email: null,
    personnelCompany: null, residence: null, startDate: null,
    imageStorageKey: null, imageFileName: null, imageMimeType: null, imageUploadedAt: null,
    isArchived: false, archivedAt: null, createdAt: now, updatedAt: now, ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SitesService.archive — soft-delete (FR-MGR-SITE-1/3)', () => {
  it('sets isArchived=true, archivedAt, status=ARCHIVED (does not hard-delete)', async () => {
    siteFindUnique.mockResolvedValue({ id: 's1' });
    siteUpdate.mockResolvedValue(baseSite({ isArchived: true, archivedAt: now, status: 'ARCHIVED' }));
    const s = await new SitesService().archive('s1');
    expect(s.isArchived).toBe(true);
    expect(s.status).toBe('ARCHIVED');
    expect(siteDelete).not.toHaveBeenCalled();
    const arg = siteUpdate.mock.calls[0][0];
    expect(arg.data).toMatchObject({ isArchived: true, status: 'ARCHIVED' });
    expect(arg.data.archivedAt).toBeInstanceOf(Date);
  });

  it('archiving a missing site → 404 NOT_FOUND', async () => {
    siteFindUnique.mockResolvedValue(null);
    await expect(new SitesService().archive('nope')).rejects.toMatchObject({
      code: 'NOT_FOUND', statusCode: 404,
    });
  });
});

describe('WorkersService.archive — move-to-archives (FR-MGR-EMP-5/6)', () => {
  it('sets isArchived + archivedAt (excluded from active roster by list filter)', async () => {
    workerFindUnique.mockResolvedValue({ id: 'w1' });
    workerUpdate.mockResolvedValue(baseWorker({ isArchived: true, archivedAt: now }));
    const svc = new WorkersService({} as never);
    const w = await svc.archive('w1');
    expect(w.isArchived).toBe(true);
    expect(w.archivedAt).not.toBeNull();
    const arg = workerUpdate.mock.calls[0][0];
    expect(arg.data.isArchived).toBe(true);
  });
});

describe('WorkersService.confirmDoc — storage-key traversal guard (Architecture §7a)', () => {
  it('rejects a storageKey that does not belong to the worker → VALIDATION', async () => {
    workerFindUnique.mockResolvedValue({ id: 'w1' });
    const supabase = { assertAllowedMime: vi.fn() };
    const svc = new WorkersService(supabase as never);
    await expect(
      svc.confirmDoc('w1', {
        type: 'PASSPORT_ID',
        storageKey: 'w2/PASSPORT_ID/evil.pdf', // belongs to a different worker
        fileName: 'p.pdf',
        mimeType: 'application/pdf',
      } as never),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
