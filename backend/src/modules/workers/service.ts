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
import {
  assertWorkerInScope,
  effectiveSiteScope,
  isForeman,
  resolveSiteScope,
} from '../../lib/scope.js';
import { SupabaseService } from '../../lib/supabase.js';
import type { AuthUser } from '../../plugins/types.js';
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

/**
 * Build a filesystem-safe, human-browsable folder slug from a worker's name.
 *
 * SECURITY (traversal-safe): the result can ONLY contain [a-z0-9-]. Every run of
 * anything else — spaces, punctuation, dots, slashes, unicode/RTL/Hebrew, path
 * separators — collapses to a single '-'. This makes '/', '..', '.' and leading
 * '/' structurally impossible in the slug. The slug is COSMETIC; the stable,
 * un-spoofable anchor is always the `__${workerId}` segment appended by callers.
 *
 * Rules: lowercase; non-[a-z0-9-] → '-'; collapse repeats; strip leading/trailing
 * '-'; cap at 40 chars (then re-strip a trailing '-'). Empty result (e.g. a purely
 * non-latin name) falls back to 'worker' so a key never starts with '__'.
 */
function nameSlug(firstName?: string | null, lastName?: string | null): string {
  const raw = `${firstName ?? ''} ${lastName ?? ''}`;
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'worker';
}

export class WorkersService {
  constructor(private readonly supabase: SupabaseService) {}

  /**
   * List workers. FOREMAN-scoped (FR-MGR-EMP LIST): when the caller is a FOREMAN the
   * result is HARD-scoped to workers assigned to one of their UNION sites via
   * `assignments.some.siteId IN union` — a Foreman NEVER sees the whole roster.
   * `effectiveSiteScope` (SECURITY helper) does the validation: a `?siteId` in the
   * Foreman's union narrows to that one site; a `?siteId` NOT in the union → 403; no
   * `?siteId` → the WHOLE union; an EMPTY union → 403 (fail-closed). ADMIN/MANAGER (or
   * no caller) keep the existing unscoped behavior (optional `?siteId` filter).
   */
  async list(query: ListQuery, caller?: AuthUser): Promise<Paginated<Worker>> {
    // Foreman: replace the client siteId filter with the server-derived union filter.
    // For ADMIN/MANAGER `effectiveSiteScope` returns { all } (siteId narrows) or a
    // single requested site — identical to the legacy behavior.
    let siteFilter: Record<string, unknown> = {};
    if (caller) {
      const scope = await effectiveSiteScope(caller, query.siteId);
      if ('all' in scope) {
        siteFilter = query.siteId
          ? { assignments: { some: { siteId: query.siteId } } }
          : {};
      } else {
        // FOREMAN (or an ADMIN/MANAGER that supplied a siteId → single-site array):
        // force assignments IN the resolved site set. NEVER trust query.siteId here.
        //
        // SOFT-DELETE BOUNDARY (nexo-back): SiteAssignment is soft-deleted
        // (`unassignedAt DateTime?`). We MUST require `unassignedAt: null` here so a
        // worker whose union-site assignment was UNASSIGNED — and who may now be active
        // only on an OUT-of-union site — does NOT leak into a foreman's LIST via the
        // stale row. This matches the reference filters (attendance/service.ts and
        // lib/scope.ts assertWorkerInScope) so LIST and VIEW agree.
        siteFilter = {
          assignments: { some: { unassignedAt: null, siteId: { in: scope.siteIds } } },
        };
      }
    } else {
      siteFilter = query.siteId
        ? { assignments: { some: { siteId: query.siteId } } }
        : {};
    }
    const where = {
      ...(query.includeArchived ? {} : { isArchived: false }),
      ...siteFilter,
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

  /**
   * Worker detail (FR-MGR-EMP VIEW). FOREMAN-scoped: `assertWorkerInScope` runs FIRST
   * (ADMIN/MANAGER no-op; a FOREMAN gets 403 when the worker is not on any of their
   * union sites). We deliberately return 403 — not 404 — for an out-of-scope worker so
   * the endpoint never confirms/denies a worker's existence to a Foreman probing ids.
   */
  async getWithDetails(id: string, caller?: AuthUser): Promise<WorkerWithDetails> {
    if (caller) await assertWorkerInScope(caller, id);
    const row = await prisma.worker.findUnique({
      where: { id },
      include: {
        docs: true,
        salaryData: true,
        assignments: true,
        // Managed personnel-company relation → resolve the display name below.
        personnelCompanyRef: { select: { name: true } },
      },
    });
    if (!row) throw AppError.notFound('Worker not found');

    // SITE-ID DISCLOSURE (nexo-back hardening): for a FOREMAN caller, only reveal the
    // sites the foreman actually MANAGES — intersect the worker's assignments with the
    // caller's union. A shared worker (also on out-of-union sites) must not leak those
    // OTHER site ids to the foreman. ADMIN/MANAGER (or no caller) get the full list.
    let siteIds = row.assignments.map((a) => a.siteId);
    if (caller && isForeman(caller)) {
      const scope = await resolveSiteScope(caller);
      const union = new Set('all' in scope ? [] : scope.siteIds);
      siteIds = siteIds.filter((sid) => union.has(sid));
    }

    return {
      ...mapWorker(row),
      docs: row.docs.map(mapWorkerDoc),
      salaryData: row.salaryData ? mapSalaryData(row.salaryData) : null,
      siteIds,
      // Resolved from the managed FK relation (null when unlinked).
      personnelCompanyName: row.personnelCompanyRef?.name ?? null,
    };
  }

  /**
   * Worker Wizard create (FR-MGR-EMP-1): Details + Salary + site assignments.
   *
   * FOREMAN-scoped (ADD): a FOREMAN may create a worker ONLY within their own scope.
   * `assertForemanCreateScope` (below) enforces, for a FOREMAN caller:
   *   - siteIds MUST be present and non-empty (a Foreman cannot create an unassigned/
   *     off-scope worker) → 400 otherwise,
   *   - EVERY siteId ∈ the Foreman's union → 403 otherwise (never trust a client site),
   *   - an EMPTY-union Foreman → 403 (fail-closed).
   * The role is HARD-CODED WORKER in the dual-write below (the schema has no role
   * field), so a Foreman cannot escalate the created identity. ADMIN/MANAGER keep the
   * existing behavior (siteIds optional). The mandatory WORKER-login dual-write runs
   * unchanged for Foreman-created workers.
   */
  async create(input: CreateInput, caller?: AuthUser): Promise<WorkerWithDetails> {
    if (caller && isForeman(caller)) {
      await this.assertForemanCreateScope(caller, input.siteIds);
    }
    // Resolve/validate the managed personnel-company FK (if the field was supplied) and
    // derive the mirrored free-text name. See `resolvePersonnelCompany` for the policy.
    const pc = await this.resolvePersonnelCompany(
      input.personnelCompanyId,
      input.personnelCompany,
    );
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
        personnelCompanyId: pc.id,
        personnelCompany: pc.name,
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

  /**
   * Modify a worker (FR-MGR-EMP EDIT). FOREMAN-scoped:
   *   1. `assertWorkerInScope` FIRST — a FOREMAN can only edit a worker on one of their
   *      union sites (403 otherwise), before any mutation.
   *   2. If `siteIds` is supplied by a FOREMAN it must be non-empty (a Foreman cannot
   *      orphan a worker to zero sites → 400) and every id ∈ their union (403 else).
   *   3. CRITICAL — assignment edits by a FOREMAN are SCOPED (setAssignmentsScoped):
   *      they may only add/remove assignments WITHIN their union; a worker's assignment
   *      to a site OUTSIDE the Foreman's union is left UNTOUCHED. A full setAssignments
   *      would replace across ALL sites and could delete an out-of-union assignment —
   *      a cross-site mutation — which we must never allow.
   * The schema has NO role field, so a Foreman can never change the worker's role via
   * EDIT. ADMIN/MANAGER keep the full-replace setAssignments behavior.
   */
  async update(id: string, input: UpdateInput, caller?: AuthUser): Promise<WorkerWithDetails> {
    const foreman = !!caller && isForeman(caller);
    if (foreman) {
      // Scope check BEFORE any read/mutation of an out-of-scope worker.
      await assertWorkerInScope(caller!, id);
      if (input.siteIds !== undefined) {
        await this.assertForemanEditSiteIds(caller!, input.siteIds);
      }
    }
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

    // Managed personnel-company FK on EDIT. Precedence: if `personnelCompanyId` is
    // present in the patch it OWNS both columns (validated FK + mirrored name, or both
    // cleared on null). Only when `personnelCompanyId` is ABSENT do we honour a bare
    // legacy `personnelCompany` free-text patch (backward compatibility).
    let companyData: Record<string, unknown> = {};
    if (input.personnelCompanyId !== undefined) {
      const pc = await this.resolvePersonnelCompany(
        input.personnelCompanyId,
        input.personnelCompany,
      );
      companyData = { personnelCompanyId: pc.id, personnelCompany: pc.name };
    } else if (input.personnelCompany !== undefined) {
      companyData = { personnelCompany: input.personnelCompany };
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
        ...companyData,
        ...(input.residence !== undefined ? { residence: input.residence } : {}),
        ...(input.startDate !== undefined
          ? { startDate: input.startDate ? new Date(input.startDate) : null }
          : {}),
      },
    });

    if (input.siteIds) {
      if (foreman) {
        // Scoped: only add/remove within the Foreman's union; out-of-union
        // assignments (e.g. a shared worker's other-site link) are preserved.
        await this.setAssignmentsScoped(id, input.siteIds, caller!);
      } else {
        await this.setAssignments(id, input.siteIds);
      }
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
   *
   * FOREMAN-scoped (SECURITY BOUNDARY): `assertWorkerInScope` runs FIRST — BEFORE any
   * URL is minted — so a FOREMAN can only request an upload for a worker on one of
   * their union sites (403 otherwise). ADMIN/MANAGER (or no caller) → no-op / unscoped.
   */
  async requestImageUpload(
    workerId: string,
    input: ImageUploadInput,
    caller?: AuthUser,
  ): Promise<SignedUploadResponse> {
    if (caller) await assertWorkerInScope(caller, workerId);
    const worker = await prisma.worker.findUnique({
      where: { id: workerId },
      select: { firstName: true, lastName: true },
    });
    if (!worker) throw AppError.notFound('Worker not found');
    this.supabase.assertAllowedMime(input.mimeType);
    // Human-browsable folder `<slug>__<workerId>`: the slug is a sanitized name
    // (cosmetic, traversal-safe) and `__<workerId>` is the stable, unique anchor.
    const slug = nameSlug(worker.firstName, worker.lastName);
    const storageKey = `${slug}__${workerId}/image/${randomUUID()}.${extFor(input.mimeType)}`;
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
   *
   * FOREMAN-scoped (SECURITY BOUNDARY): `assertWorkerInScope` runs FIRST — BEFORE any
   * persistence — so a FOREMAN can only confirm an image for a worker on one of their
   * union sites (403 otherwise). ADMIN/MANAGER (or no caller) → no-op / unscoped. The
   * server-key traversal guard (`startsWith`) still applies for all callers.
   */
  async confirmImage(
    workerId: string,
    input: ImageConfirmInput,
    caller?: AuthUser,
  ): Promise<Worker> {
    if (caller) await assertWorkerInScope(caller, workerId);
    const worker = await prisma.worker.findUnique({ where: { id: workerId } });
    if (!worker) throw AppError.notFound('Worker not found');
    this.supabase.assertAllowedMime(input.mimeType);
    // Traversal guard. The key is `<slug>__<workerId>/image/<uuid>.<ext>`, so the
    // stable, un-spoofable anchor `__<workerId>/` now sits MID-PATH (not a prefix).
    // Require that exact anchor and reject any path-traversal shape. A foreman can't
    // confirm another worker's key: it must contain THIS worker's `__<id>/` AND the
    // :id-scoped assertWorkerInScope already ran above.
    if (
      !input.storageKey.includes(`__${workerId}/`) ||
      input.storageKey.includes('..') ||
      input.storageKey.startsWith('/')
    ) {
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

  /**
   * Mint a short-lived signed READ URL for the worker's profile image.
   *
   * FOREMAN-scoped (SECURITY BOUNDARY): `assertWorkerInScope` runs FIRST — BEFORE any
   * URL is minted — so a FOREMAN can only read the image of a worker on one of their
   * union sites (403 otherwise). ADMIN/MANAGER (or no caller) → no-op / unscoped.
   */
  async getImageReadUrl(workerId: string, caller?: AuthUser): Promise<SignedReadResponse> {
    if (caller) await assertWorkerInScope(caller, workerId);
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

  // ── Foreman scope guards (SECURITY BOUNDARY) ─────────────────────────────

  /**
   * ADD guard for a FOREMAN caller. Resolves the caller's server-derived union and
   * requires the requested `siteIds` to be present, non-empty, and ENTIRELY inside
   * that union — so a Foreman can only ever create a worker on their OWN site(s).
   *   - empty union → 403 (fail-closed),
   *   - siteIds absent/empty → 400 (a Foreman cannot create an unassigned worker),
   *   - any siteId ∉ union → 403 (never trust a client-supplied site).
   */
  private async assertForemanCreateScope(
    caller: AuthUser,
    siteIds: string[] | undefined,
  ): Promise<void> {
    const scope = await resolveSiteScope(caller); // FOREMAN → { siteIds }
    const union = 'all' in scope ? [] : scope.siteIds;
    if (union.length === 0) throw AppError.forbidden();
    if (!siteIds || siteIds.length === 0) {
      throw AppError.validation('A foreman must assign the new worker to at least one site');
    }
    for (const id of siteIds) {
      if (!union.includes(id)) throw AppError.forbidden();
    }
  }

  /**
   * EDIT guard for a FOREMAN-supplied `siteIds`. The set must be non-empty (a Foreman
   * cannot strip a worker to zero sites = orphan/escape) and every id must be inside
   * the Foreman's union (403 otherwise). Note this validates only what the Foreman
   * ASKS for; the actual write (setAssignmentsScoped) additionally guarantees no
   * out-of-union assignment is removed.
   */
  private async assertForemanEditSiteIds(
    caller: AuthUser,
    siteIds: string[],
  ): Promise<void> {
    const scope = await resolveSiteScope(caller);
    const union = 'all' in scope ? [] : scope.siteIds;
    if (union.length === 0) throw AppError.forbidden();
    if (siteIds.length === 0) {
      throw AppError.validation('A foreman cannot remove a worker from all sites');
    }
    for (const id of siteIds) {
      if (!union.includes(id)) throw AppError.forbidden();
    }
  }

  /**
   * SCOPED assignment setter for a FOREMAN (CRITICAL cross-site-mutation guard).
   *
   * Unlike `setAssignments` (a full replace across ALL sites), this ONLY reconciles
   * assignments WITHIN the Foreman's union: it removes union-site assignments the
   * Foreman dropped from `requestedSiteIds` and adds the union sites they requested.
   * Any assignment to a site OUTSIDE the Foreman's union is left completely UNTOUCHED
   * — so a shared worker on siteA(union)+siteB(not-union) whose Foreman PATCHes
   * siteIds=[siteA] keeps the siteB assignment (no cross-site deletion).
   *
   * `requestedSiteIds` is pre-validated all-in-union by `assertForemanEditSiteIds`.
   */
  private async setAssignmentsScoped(
    workerId: string,
    requestedSiteIds: string[],
    caller: AuthUser,
  ): Promise<void> {
    const scope = await resolveSiteScope(caller);
    const union = 'all' in scope ? [] : scope.siteIds;
    const requested = [...new Set(requestedSiteIds)];
    await prisma.$transaction([
      // Delete ONLY union sites the Foreman dropped — scoped by `siteId IN union` so an
      // out-of-union assignment can never be reached by this deleteMany.
      prisma.siteAssignment.deleteMany({
        where: {
          workerId,
          siteId: { in: union, notIn: requested.length ? requested : ['__none__'] },
        },
      }),
      ...requested.map((siteId) =>
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

  /**
   * Resolve the managed personnel-company FK for a create/update.
   *
   * POLICY:
   *   - `personnelCompanyId` UNDEFINED → no FK link requested. Fall back to the legacy
   *     free-text `personnelCompany` as-is (name = provided free-text ?? null, id null).
   *   - `personnelCompanyId` === null → EXPLICIT clear: null the FK AND null the mirror.
   *   - `personnelCompanyId` a string → it MUST reference an EXISTING, NON-ARCHIVED
   *     PersonnelCompany, else 400 'Personnel company not found' (we never link to an
   *     archived or nonexistent company). On success we MIRROR the company NAME into the
   *     legacy free-text column so old readers stay consistent through the transition.
   *
   * Returns the pair to persist: { id, name } where `id` → Worker.personnelCompanyId and
   * `name` → the legacy Worker.personnelCompany free-text column.
   */
  private async resolvePersonnelCompany(
    personnelCompanyId: string | null | undefined,
    freeText: string | null | undefined,
  ): Promise<{ id: string | null; name: string | null }> {
    if (personnelCompanyId === undefined) {
      // No managed link requested — preserve legacy free-text behavior.
      return { id: null, name: freeText ?? null };
    }
    if (personnelCompanyId === null) {
      // Explicit unlink: clear FK and mirror together.
      return { id: null, name: null };
    }
    const company = await prisma.personnelCompany.findFirst({
      where: { id: personnelCompanyId, isArchived: false },
      select: { id: true, name: true },
    });
    if (!company) {
      // Nonexistent OR archived → refuse the link (400, not a raw FK error).
      throw AppError.validation('Personnel company not found');
    }
    return { id: company.id, name: company.name };
  }
}
