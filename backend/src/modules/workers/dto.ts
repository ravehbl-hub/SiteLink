/**
 * SiteLink back end — workers module local wire DTOs for Storage signing.
 *
 * These describe the back-end-minted signed-URL responses (Architecture §7a). They
 * are back-end response shapes (not persisted entities), kept here rather than in
 * @sitelink/shared to avoid coupling the shared spine to Storage specifics. The
 * service-role key is NEVER part of any of these — only short-lived signed URLs.
 */

/** Response to a signed-upload request (client PUTs bytes to `uploadUrl`). */
export interface SignedUploadResponse {
  storageKey: string;
  uploadUrl: string;
  token: string;
  bucket: string;
}

/** Response with a short-lived signed READ URL for an existing object. */
export interface SignedReadResponse {
  url: string;
  expiresInSeconds: number;
}
