/**
 * Typed fetch client bound to the SiteLink REST contract (Architecture §3.2).
 *
 * - Attaches the Supabase access token as `Authorization: Bearer <jwt>` on every
 *   call (§5.1). The token is read live from the Supabase SDK session so it is
 *   always the freshest (auto-refreshed) access token.
 * - Unwraps the standard error envelope `{ error: { code, message, details? } }`
 *   into a thrown `ApiError`.
 * - 204 responses resolve to `undefined`.
 */
import { config } from './config';
import { supabase } from './supabase';

export class ApiError extends Error {
  code: string;
  status: number;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; details?: unknown };
}

type QueryValue = string | number | boolean | null | undefined;
/** Accepts any object of scalar values (interfaces without index signatures included). */
type Query = Record<string, QueryValue> | object;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  query?: Query;
  body?: unknown;
  /** Skip attaching the bearer token (unused for now — all routes are authed). */
  anonymous?: boolean;
}

async function getAccessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

function buildUrl(path: string, query?: Query): string {
  const base = config.apiBaseUrl.replace(/\/$/, '');
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query as Record<string, QueryValue>)) {
    if (value !== undefined && value !== null) params.append(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  if (!config.isConfigured) {
    throw new ApiError(0, 'NOT_CONFIGURED', 'App is not configured (missing EXPO_PUBLIC_* env).');
  }
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (!opts.anonymous) {
    const token = await getAccessToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    throw new ApiError(0, 'NETWORK', e instanceof Error ? e.message : 'Network request failed');
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : undefined;

  if (!res.ok) {
    const env = (json ?? {}) as ErrorEnvelope;
    throw new ApiError(
      res.status,
      env.error?.code ?? 'HTTP_ERROR',
      env.error?.message ?? `Request failed (${res.status})`,
      env.error?.details,
    );
  }
  return json as T;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>(path, { method: 'GET', query }),
  post: <T>(path: string, body?: unknown, query?: Query) =>
    request<T>(path, { method: 'POST', body, query }),
  patch: <T>(path: string, body?: unknown, query?: Query) =>
    request<T>(path, { method: 'PATCH', body, query }),
  put: <T>(path: string, body?: unknown, query?: Query) =>
    request<T>(path, { method: 'PUT', body, query }),
  del: <T>(path: string, query?: Query) => request<T>(path, { method: 'DELETE', query }),
};

/**
 * Upload bytes to a Supabase signed upload URL (Architecture §7a step 3).
 * The back end mints the URL; the client PUTs the object directly to Supabase.
 */
export async function uploadToSignedUrl(
  uploadUrl: string,
  uri: string,
  mimeType: string,
): Promise<void> {
  const fileRes = await fetch(uri);
  const blob = await fileRes.blob();
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    body: blob,
  });
  if (!res.ok) {
    throw new ApiError(res.status, 'UPLOAD_FAILED', `Storage upload failed (${res.status})`);
  }
}
