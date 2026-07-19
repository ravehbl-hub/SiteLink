/**
 * SiteLink back end — Supabase service-role client (Architecture §5.4 + §7a).
 *
 * SECURITY RULE: the service-role key lives ONLY here, server-side. It is never
 * returned to any client, never logged, never placed in a response. Clients only
 * ever receive short-lived signed URLs minted by this module.
 *
 * Responsibilities:
 *   - Admin API: create/invite/delete/ban Supabase Auth users (user provisioning).
 *   - Storage: mint short-lived signed upload/read URLs on PRIVATE buckets.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AppConfig } from '../config.js';
import { AppError } from './errors.js';

/** Allow-list of MIME types per Architecture §7a (image/* or application/pdf). */
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
]);

/** Max upload size accepted for a worker doc/image (bytes). */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB

/** Short TTL (seconds) for read URLs — links can't be shared long-term. */
const READ_URL_TTL_SECONDS = 120;

/**
 * Longer TTL (seconds) for ASYNCHRONOUS share links (e.g. a payslip PDF link sent
 * over WhatsApp): the recipient may not open the message for a while, so 120s would
 * expire before they tap. 30 minutes balances usability against the fact that the
 * signed URL is a bearer capability to salary data.
 */
export const SHARE_URL_TTL_SECONDS = 30 * 60;

export interface SignedUpload {
  /** Server-chosen object key (never client-supplied — prevents traversal). */
  storageKey: string;
  /** Short-lived signed URL the client PUTs the bytes to. */
  uploadUrl: string;
  /** Opaque token some clients need alongside the URL. */
  token: string;
  bucket: string;
}

export interface SignedRead {
  url: string;
  expiresInSeconds: number;
}

/**
 * Map a Supabase Admin create/invite error to a client-facing AppError.
 *
 * SECURITY: provider errors are generic by default (never leak Supabase-internal
 * detail). The ONE exception is "email already registered" — safe and useful to
 * surface on the ADMIN-gated Users screen so the admin knows the email is taken.
 * Everything else stays a generic 409.
 */
function mapCreateAuthError(error: { code?: string; status?: number; message?: string } | null): AppError {
  const code = error?.code?.toLowerCase() ?? '';
  const msg = error?.message?.toLowerCase() ?? '';
  const isDuplicate =
    code === 'email_exists' ||
    code === 'user_already_exists' ||
    error?.status === 422 ||
    msg.includes('already been registered') ||
    msg.includes('already registered') ||
    msg.includes('already exists');
  if (isDuplicate) {
    return new AppError('USER_EMAIL_EXISTS', 'A user with this email already exists');
  }
  return AppError.conflict('Could not create user identity');
}

export class SupabaseService {
  private readonly client: SupabaseClient;
  private readonly bucketDocs: string;
  private readonly bucketImages: string;

  constructor(config: AppConfig) {
    // Service-role client: full access, server-only. autoRefreshToken/persistSession
    // off — this is a stateless back-end client, not a user session.
    this.client = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    this.bucketDocs = config.STORAGE_BUCKET_WORKER_DOCS;
    this.bucketImages = config.STORAGE_BUCKET_WORKER_IMAGES;
  }

  // ── Admin API (user provisioning, §5.4) ──────────────────────────────────

  /**
   * Create a Supabase Auth identity. If a password is provided the user is created
   * directly (email confirmed); otherwise an invite email is sent and the user sets
   * their own password. Returns the Supabase auth user id (the FK to our User row).
   */
  async createAuthUser(input: {
    email: string;
    password?: string;
  }): Promise<{ authUserId: string }> {
    if (input.password) {
      const { data, error } = await this.client.auth.admin.createUser({
        email: input.email,
        password: input.password,
        email_confirm: true,
      });
      if (error || !data.user) {
        if (error) console.error('[supabase] createUser failed:', error.message);
        throw mapCreateAuthError(error);
      }
      return { authUserId: data.user.id };
    }
    const { data, error } = await this.client.auth.admin.inviteUserByEmail(input.email);
    if (error || !data.user) {
      if (error) console.error('[supabase] inviteUserByEmail failed:', error.message);
      throw mapCreateAuthError(error);
    }
    return { authUserId: data.user.id };
  }

  /** Compensating action: delete a just-created auth user when the dual-write fails. */
  async deleteAuthUser(authUserId: string): Promise<void> {
    await this.client.auth.admin.deleteUser(authUserId);
  }

  /**
   * Mirror app-level lockout to Supabase so a locked user cannot obtain a session
   * (§5.4). `ban_duration: 'none'` lifts the ban.
   */
  async setUserLockout(authUserId: string, locked: boolean): Promise<void> {
    const { error } = await this.client.auth.admin.updateUserById(authUserId, {
      ban_duration: locked ? '876000h' : 'none', // ~100 years vs unbanned
    });
    if (error) throw AppError.internal('Failed to update auth lockout state');
  }

  // ── Storage (worker docs/images, §7a) ────────────────────────────────────

  private bucketFor(kind: 'doc' | 'image'): string {
    return kind === 'doc' ? this.bucketDocs : this.bucketImages;
  }

  /** Validate intent (MIME allow-list) before minting an upload URL. */
  assertAllowedMime(mimeType: string): void {
    if (!ALLOWED_MIME.has(mimeType)) {
      throw AppError.validation(`Unsupported file type: ${mimeType}`);
    }
  }

  /**
   * Mint a short-lived signed upload URL scoped to a SERVER-chosen key. The client
   * uploads directly to Supabase; the FileRef row is only persisted after the
   * back end re-validates the stored object (see workers doc service).
   */
  async createSignedUpload(params: {
    kind: 'doc' | 'image';
    storageKey: string;
  }): Promise<SignedUpload> {
    const bucket = this.bucketFor(params.kind);
    const { data, error } = await this.client.storage
      .from(bucket)
      .createSignedUploadUrl(params.storageKey);
    if (error || !data) {
      throw AppError.internal('Failed to create signed upload URL');
    }
    return {
      storageKey: params.storageKey,
      uploadUrl: data.signedUrl,
      token: data.token,
      bucket,
    };
  }

  /**
   * Upload SERVER-GENERATED bytes directly (service-role) under a SERVER-chosen
   * key. Used by the payslip-share WhatsApp flow: the back end generates the PDF
   * in-process and stores it so a short-lived signed READ URL can be minted. The
   * key is never client-supplied (traversal-safe). `upsert` is off so a fresh
   * uuid key never collides. On failure returns a generic AppError (no leak).
   */
  async uploadObject(params: {
    kind: 'doc' | 'image';
    storageKey: string;
    content: Buffer;
    contentType: string;
  }): Promise<{ storageKey: string; bucket: string }> {
    const bucket = this.bucketFor(params.kind);
    const { error } = await this.client.storage
      .from(bucket)
      .upload(params.storageKey, params.content, {
        contentType: params.contentType,
        upsert: false,
      });
    if (error) {
      throw AppError.internal('Failed to store file');
    }
    return { storageKey: params.storageKey, bucket };
  }

  /** Mint a short-lived signed READ URL for an existing object. */
  async createSignedRead(params: {
    kind: 'doc' | 'image';
    storageKey: string;
    // Optional TTL override. Defaults to READ_URL_TTL_SECONDS (120s) for the
    // interactive upload/read flows. ASYNCHRONOUS shares (e.g. a payslip link sent
    // over WhatsApp — the worker may open it minutes/hours later) pass a longer
    // SHARE_URL_TTL_SECONDS so the link isn't dead before they tap it. Still a
    // bearer capability, so kept bounded (30 min), not indefinite.
    expiresInSeconds?: number;
  }): Promise<SignedRead> {
    const ttl = params.expiresInSeconds ?? READ_URL_TTL_SECONDS;
    const bucket = this.bucketFor(params.kind);
    const { data, error } = await this.client.storage
      .from(bucket)
      .createSignedUrl(params.storageKey, ttl);
    if (error || !data) {
      throw AppError.notFound('File not found or not accessible');
    }
    return { url: data.signedUrl, expiresInSeconds: ttl };
  }

  /** Remove an object (on doc removal / worker purge — keeps DB + storage in sync). */
  async removeObject(params: { kind: 'doc' | 'image'; storageKey: string }): Promise<void> {
    const bucket = this.bucketFor(params.kind);
    await this.client.storage.from(bucket).remove([params.storageKey]);
  }
}
