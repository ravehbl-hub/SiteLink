/**
 * SiteLink back end — workers service (FR-MGR-EMP).
 *
 * Worker Wizard create (Details + optional Salary data + site assignments), details
 * CRUD, docs (signed upload/read URLs on private Storage — the DB stores only the
 * key), salary-data, and Add/Modify/Remove/Archive.
 *
 * Storage keys are ALWAYS server-generated (never client-supplied) to prevent path
 * traversal/overwrite (Architecture §7a). Signed URLs are minted only after the
 * back end authorizes the request.
 */
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type {
  Paginated,
  Worker,
  WorkerDoc,
  WorkerSalaryData,
  WorkerWithDetails,
} from '@sitelink/shared';
import { Role } from '@sitelink/shared';
import type { SignedReadResponse, SignedUploadResponse } from './dto.js';
import { prisma } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { mapSalaryData, mapWorker, mapWorkerDoc } from '../../lib/mappers.js';
import { paginate } from '../../lib/pagination.js';
import { SupabaseService } from '../../lib/supabase.js';
import type {
  confirmDocSchema,
  confirmImageSchema,
  createWorkerSchema,
  listWorkersQuery,
  requestDocUploadSchema,
  requestImageUploadSchema,
  salaryDataSchema,
  updateWorkerSchema,
} from './schemas.js';

type CreateInput = z.infer<typeof createWorkerSchema>;
type UpdateInput = z.infer<typeof updateWorkerSchema>;
type ListQuery = z.infer<typeof listWorkersQuery>;
type SalaryInput = z.infer<typeof salaryDataSchema>;
type DocUploadInput = z.infer<typeof requestDocUploadSchema>;
type DocConfirmInput = z.infer<typeof confirmDocSchema>;
type ImageUploadInput = z.infer<typeof requestImageUploadSchema>;
type ImageConfirmInput = z.infer<typeof confirmImageSchema>;

/** Map an allowed MIME to a file extension for the server-chosen storage key. */
function extFor(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'application/pdf': 'pdf',
  };
  return map[mimeType] ?? 'bin';
}

export class WorkersService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(query: ListQuery): Promise<Paginated<Worker>> {
    const where = {
      ...(query.includeArchived ? {} : { isArchived: false }),
      ...(query.siteId ? { assignments: { some: { siteId: query.siteId } } } : {}),
    };
    const skip = (query.page - 1) * query.pageSize;
    const [rows, total] = await Promise.all([
      prisma.worker.findMany({
        where,
        skip,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.worker.count({ where }),
    ]);
    return paginate(rows.map(mapWorker), total, {
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  async getWithDetails(id: string): Promise<WorkerWithDetails> {
    const row = await prisma.worker.findUnique({
      where: { id },
      include: { docs: true, salaryData: true, assignments: true },
    });
    if (!row) throw AppError.notFound('Worker not found');
    return {
      ...mapWorker(row),
      docs: row.docs.map(mapWorkerDoc),
      salaryData: row.salaryData ? mapSalaryData(row.salaryData) : null,
      siteIds: row.assignments.map((a) => a.siteId),
    };
  }

  /** Worker Wizard create (FR-MGR-EMP-1): Details + Salary + site assignments. */
  async create(input: CreateInput): Promise<WorkerWithDetails> {
    const created = await prisma.worker.create({
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        profession: input.profession,
        level: input.level,
        country: input.country ?? null,
        address: input.address ?? null,
        qualityOfWorks: input.qualityOfWorks ?? null,
        phone: input.phone ?? null,
        email: input.email,
        personnelCompany: input.personnelCompany ?? null,
        residence: input.residence ?? null,
        startDate: input.startDate ? new Date(input.startDate) : null,
        ...(input.siteIds && input.siteIds.length > 0
          ? {
              assignments: {
                create: input.siteIds.map((siteId) => ({ siteId })),
              },
            }
          : {}),
        ...(input.salaryData
          ? {
              salaryData: {
                create: {
                  hourlyWage: input.salaryData.hourlyWage,
                  rateType: input.salaryData.rateType,
                  workingConditions: input.salaryData.workingConditions ?? null,
                  currency: input.salaryData.currency,
                },
              },
            }
          : {}),
      },
    });

    // MANDATORY create-time WORKER LOGIN dual-write (Phase 05 Stage C, forward-only).
    // EVERY new worker gets a WORKER login provisioned from its OWN email — there is
    // no login-less create path anymore. Mirrors the users-service provisioning:
    //   Supabase identity → app User(role WORKER, authUserId) → link Worker.userId.
    // The whole thing is one unit of work: if ANY step fails we roll back everything
    // we created (Supabase identity, User row, and the Worker itself) so no orphaned
    // Supabase identity, no half-linked login, and no login-less ghost worker survive.
    await this.provisionAndLinkLogin(created.id, input);

    return this.getWithDetails(created.id);
  }

  /**
   * Provision a Supabase identity + app User(role WORKER) from the worker's own email
   * and link it to the just-created Worker via Worker.userId. `password` optional —
   * omit to send a Supabase INVITE (worker sets their own password), matching the
   * Users Manager flow. Compensating rollback on any failure: delete the User row (if
   * written), the Supabase identity (if created), and the Worker (so a provisioning
   * failure never leaves a partial Worker behind).
   */
  private async provisionAndLinkLogin(
    workerId: string,
    input: CreateInput,
  ): Promise<void> {
    // Guard the app-side unique constraint up front (User.email is unique).
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      await prisma.worker.delete({ where: { id: workerId } }).catch(() => undefined);
      throw AppError.conflict('A user with this login email already exists');
    }

    // Step 1 — provision the Supabase identity (invite-by-email when no password).
    const { authUserId } = await this.supabase
      .createAuthUser({ email: input.email, password: input.password })
      .catch(async (err: unknown) => {
        // No identity was created → only the Worker needs unwinding.
        await prisma.worker.delete({ where: { id: workerId } }).catch(() => undefined);
        throw err instanceof AppError
          ? err
          : AppError.conflict('Failed to provision worker login');
      });

    // Step 2 — app User row (role WORKER) + link Worker.userId, atomically.
    try {
      await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            authUserId,
            role: Role.WORKER,
            fullName: `${input.firstName} ${input.lastName}`.trim(),
            email: input.email,
          },
        });
        await tx.worker.update({ where: { id: workerId }, data: { userId: user.id } });
      });
    } catch (err) {
      // Compensate — unwind everything so nothing partial is left behind.
      await this.supabase.deleteAuthUser(authUserId).catch(() => undefined);
      await prisma.worker.delete({ where: { id: workerId } }).catch(() => undefined);
      throw err instanceof AppError
        ? err
        : AppError.conflict('Failed to link worker login; provisioning rolled back');
    }
  }

  async update(id: string, input: UpdateInput): Promise<WorkerWithDetails> {
    const before = await prisma.worker.findUnique({
      where: { id },
      select: { id: true, email: true, userId: true },
    });
    if (!before) throw AppError.notFound('Worker not found');

    // Email-change propagation to the linked WORKER login (Phase 05 Stage C).
    // If the worker HAS a linked User and the email actually changes, keep the app
    // User.email in sync so the login identity never diverges from the worker record.
    //
    // SUPABASE LIMITATION (flagged, not silently ignored): changing the Supabase Auth
    // identity email is a separate admin operation that triggers an email-confirmation
    // round-trip (updateUserById with email → pending confirm). We deliberately do NOT
    // mutate the Supabase identity email here — the app User.email is the source of
    // truth for display/scoping, and the Supabase login email stays as originally
    // provisioned. If a future story requires re-keying the Supabase login email, add
    // a supabase.updateUserEmail(authUserId, email) admin call + confirmation handling.
    if (
      input.email !== undefined &&
      input.email !== null &&
      before.userId &&
      input.email !== before.email
    ) {
      // Guard User.email uniqueness before propagating (avoids a raw P2002).
      const clash = await prisma.user.findUnique({ where: { email: input.email } });
      if (clash && clash.id !== before.userId) {
        throw AppError.conflict('A user with this login email already exists');
      }
      await prisma.user.update({
        where: { id: before.userId },
        data: { email: input.email },
      });
    }

    await prisma.worker.update({
      where: { id },
      data: {
        ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
        ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
        ...(input.profession !== undefined ? { profession: input.profession } : {}),
        ...(input.level !== undefined ? { level: input.level } : {}),
        ...(input.country !== undefined ? { country: input.country } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.qualityOfWorks !== undefined
          ? { qualityOfWorks: input.qualityOfWorks }
          : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.personnelCompany !== undefined
          ? { personnelCompany: input.personnelCompany }
          : {}),
        ...(input.residence !== undefined ? { residence: input.residence } : {}),
        ...(input.startDate !== undefined
          ? { startDate: input.startDate ? new Date(input.startDate) : null }
          : {}),
      },
    });

    if (input.siteIds) {
      await this.setAssignments(id, input.siteIds);
    }
    return this.getWithDetails(id);
  }

  /** Archive (move-to-archives, FR-MGR-EMP-5/6). Excluded from active rosters. */
  async archive(id: string): Promise<Worker> {
    await this.ensureExists(id);
    const row = await prisma.worker.update({
      where: { id },
      data: { isArchived: true, archivedAt: new Date() },
    });
    return mapWorker(row);
  }

  /** Hard delete (FR-MGR-EMP-5). Also purge stored objects to stay in sync. */
  async remove(id: string): Promise<void> {
    const worker = await prisma.worker.findUnique({
      where: { id },
      include: { docs: true },
    });
    if (!worker) throw AppError.notFound('Worker not found');
    for (const doc of worker.docs) {
      await this.supabase
        .removeObject({ kind: 'doc', storageKey: doc.storageKey })
        .catch(() => undefined);
    }
    if (worker.imageStorageKey) {
      await this.supabase
        .removeObject({ kind: 'image', storageKey: worker.imageStorageKey })
        .catch(() => undefined);
    }
    await prisma.worker.delete({ where: { id } });
  }

  // ── Salary data (FR-MGR-EMP-4) ───────────────────────────────────────────

  async upsertSalaryData(workerId: string, input: SalaryInput): Promise<WorkerSalaryData> {
    await this.ensureExists(workerId);
    const row = await prisma.workerSalaryData.upsert({
      where: { workerId },
      create: {
        workerId,
        hourlyWage: input.hourlyWage,
        rateType: input.rateType,
        workingConditions: input.workingConditions ?? null,
        currency: input.currency,
      },
      update: {
        hourlyWage: input.hourlyWage,
        rateType: input.rateType,
        workingConditions: input.workingConditions ?? null,
        currency: input.currency,
      },
    });
    return mapSalaryData(row);
  }

  // ── Docs (FR-MGR-EMP-3, Architecture §7a) ────────────────────────────────

  async listDocs(workerId: string): Promise<WorkerDoc[]> {
    await this.ensureExists(workerId);
    const rows = await prisma.workerDoc.findMany({
      where: { workerId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(mapWorkerDoc);
  }

  /**
   * Step 1 of upload: authorize + validate intent (MIME allow-list), then mint a
   * short-lived signed upload URL scoped to a SERVER-chosen key.
   */
  async requestDocUpload(
    workerId: string,
    input: DocUploadInput,
  ): Promise<SignedUploadResponse> {
    await this.ensureExists(workerId);
    this.supabase.assertAllowedMime(input.mimeType);
    const storageKey = `${workerId}/${input.type}/${randomUUID()}.${extFor(input.mimeType)}`;
    const signed = await this.supabase.createSignedUpload({ kind: 'doc', storageKey });
    return {
      storageKey: signed.storageKey,
      uploadUrl: signed.uploadUrl,
      token: signed.token,
      bucket: signed.bucket,
    };
  }

  /**
   * Step 2 of upload: persist the FileRef row after the client confirms a completed
   * upload. Only accepts a key that matches the server-chosen prefix for this
   * worker (defense against a client claiming an arbitrary key).
   */
  async confirmDoc(workerId: string, input: DocConfirmInput): Promise<WorkerDoc> {
    await this.ensureExists(workerId);
    this.supabase.assertAllowedMime(input.mimeType);
    if (!input.storageKey.startsWith(`${workerId}/`)) {
      throw AppError.validation('storageKey does not belong to this worker');
    }
    const row = await prisma.workerDoc.create({
      data: {
        workerId,
        type: input.type,
        storageKey: input.storageKey,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes ?? null,
        reference: input.reference ?? null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      },
    });
    return mapWorkerDoc(row);
  }

  /** Mint a short-lived signed READ URL for a stored doc. */
  async getDocReadUrl(workerId: string, docId: string): Promise<SignedReadResponse> {
    const doc = await prisma.workerDoc.findFirst({ where: { id: docId, workerId } });
    if (!doc) throw AppError.notFound('Document not found');
    const signed = await this.supabase.createSignedRead({
      kind: 'doc',
      storageKey: doc.storageKey,
    });
    return { url: signed.url, expiresInSeconds: signed.expiresInSeconds };
  }

  async removeDoc(workerId: string, docId: string): Promise<void> {
    const doc = await prisma.workerDoc.findFirst({ where: { id: docId, workerId } });
    if (!doc) throw AppError.notFound('Document not found');
    await this.supabase
      .removeObject({ kind: 'doc', storageKey: doc.storageKey })
      .catch(() => undefined);
    await prisma.workerDoc.delete({ where: { id: docId } });
  }

  // ── Profile image (FR-MGR-EMP-2, Architecture §7a) ───────────────────────
  // Symmetric to the docs flow but on the PRIVATE worker-images bucket. The
  // Worker.image FileRef columns (imageStorageKey/imageFileName/imageMimeType/
  // imageUploadedAt) already exist — no new schema.

  /**
   * Step 1: authorize + validate intent (image/* allow-list), then mint a
   * short-lived signed upload URL scoped to a SERVER-chosen key on worker-images.
   */
  async requestImageUpload(
    workerId: string,
    input: ImageUploadInput,
  ): Promise<SignedUploadResponse> {
    await this.ensureExists(workerId);
    this.supabase.assertAllowedMime(input.mimeType);
    const storageKey = `${workerId}/image/${randomUUID()}.${extFor(input.mimeType)}`;
    const signed = await this.supabase.createSignedUpload({ kind: 'image', storageKey });
    return {
      storageKey: signed.storageKey,
      uploadUrl: signed.uploadUrl,
      token: signed.token,
      bucket: signed.bucket,
    };
  }

  /**
   * Step 2: persist the FileRef onto Worker.image after the client confirms a
   * completed upload. Re-checks the key belongs to this worker (traversal guard).
   * If an image already existed, purge the old object to avoid orphaned bytes.
   */
  async confirmImage(workerId: string, input: ImageConfirmInput): Promise<Worker> {
    const worker = await prisma.worker.findUnique({ where: { id: workerId } });
    if (!worker) throw AppError.notFound('Worker not found');
    this.supabase.assertAllowedMime(input.mimeType);
    if (!input.storageKey.startsWith(`${workerId}/`)) {
      throw AppError.validation('storageKey does not belong to this worker');
    }
    // Purge a superseded image object (best-effort) so storage stays in sync.
    if (worker.imageStorageKey && worker.imageStorageKey !== input.storageKey) {
      await this.supabase
        .removeObject({ kind: 'image', storageKey: worker.imageStorageKey })
        .catch(() => undefined);
    }
    const row = await prisma.worker.update({
      where: { id: workerId },
      data: {
        imageStorageKey: input.storageKey,
        imageFileName: input.fileName,
        imageMimeType: input.mimeType,
        imageUploadedAt: new Date(),
      },
    });
    return mapWorker(row);
  }

  /** Mint a short-lived signed READ URL for the worker's profile image. */
  async getImageReadUrl(workerId: string): Promise<SignedReadResponse> {
    const worker = await prisma.worker.findUnique({
      where: { id: workerId },
      select: { imageStorageKey: true },
    });
    if (!worker) throw AppError.notFound('Worker not found');
    if (!worker.imageStorageKey) throw AppError.notFound('Worker has no profile image');
    const signed = await this.supabase.createSignedRead({
      kind: 'image',
      storageKey: worker.imageStorageKey,
    });
    return { url: signed.url, expiresInSeconds: signed.expiresInSeconds };
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async setAssignments(workerId: string, siteIds: string[]): Promise<void> {
    const unique = [...new Set(siteIds)];
    await prisma.$transaction([
      prisma.siteAssignment.deleteMany({
        where: { workerId, siteId: { notIn: unique.length ? unique : ['__none__'] } },
      }),
      ...unique.map((siteId) =>
        prisma.siteAssignment.upsert({
          where: { siteId_workerId: { siteId, workerId } },
          create: { siteId, workerId },
          update: {},
        }),
      ),
    ]);
  }

  private async ensureExists(id: string): Promise<void> {
    const exists = await prisma.worker.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw AppError.notFound('Worker not found');
  }
}
