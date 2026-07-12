/**
 * @sitelink/shared — Common primitives shared by all domain types.
 * Framework-agnostic: no Prisma, no React imports.
 */

/** ISO-8601 date or date-time string, e.g. "2026-07-12" or "2026-07-12T09:00:00Z". */
export type ISODate = string;

/** Opaque unique identifier (cuid/uuid string). */
export type ID = string;

/** Fields present on every persisted entity. */
export interface Timestamped {
  createdAt: ISODate;
  updatedAt: ISODate;
}

/** Entities that support soft-delete / move-to-archives (PRD FR-MGR-EMP-5/6, FR-MGR-SITE-1/3). */
export interface Archivable {
  isArchived: boolean;
  archivedAt?: ISODate | null;
}

/** Reference to an access-controlled stored file (PRD NFR-SEC-4, Data Domain "Documents/Media"). */
export interface FileRef {
  /** Storage key / path in the access-controlled document store. */
  storageKey: string;
  /** Original filename as uploaded. */
  fileName: string;
  /** MIME type, e.g. "image/jpeg", "application/pdf". */
  mimeType: string;
  /** Size in bytes, if known. */
  sizeBytes?: number;
  /** When the file was uploaded (PRD FR-MGR-EMP-3 retains upload timestamp). */
  uploadedAt: ISODate;
}

/** Standard paginated list envelope for list endpoints (NFR-PERF-2). */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
