/**
 * Typed fetch wrapper for the SiteLink back end (Architecture §3.3).
 *
 * - Attaches the Supabase session access token as `Authorization: Bearer <jwt>`
 *   (Architecture §5.1) — resolved lazily per request so refreshes are picked up.
 * - Unwraps the back end's `{ error: { code, message, details? } }` envelope into
 *   a thrown `ApiError`; success bodies are returned as-is.
 * - Handles 204 No Content (returns undefined).
 */
import { getSupabase } from '../supabase/client';
import { env, isApiConfigured } from '../env';

export interface ApiErrorEnvelope {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  constructor(status: number, env: ApiErrorEnvelope) {
    super(env.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = env.code;
    this.details = env.details;
  }
}

export class ApiNotConfiguredError extends Error {
  constructor() {
    super('The SiteLink back end is not configured (set VITE_API_BASE_URL).');
    this.name = 'ApiNotConfiguredError';
  }
}

type QueryValue = string | number | boolean | null | undefined;
export type Query = Record<string, QueryValue>;

interface RequestOptions {
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: Query): string {
  const base = env.apiBaseUrl.replace(/\/$/, '');
  const url = new URL(`${base}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

async function authHeader(): Promise<Record<string, string>> {
  const supabase = getSupabase();
  if (!supabase) return {};
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(
  method: string,
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  if (!isApiConfigured) throw new ApiNotConfiguredError();

  const headers: Record<string, string> = { ...(await authHeader()) };
  let bodyInit: BodyInit | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    bodyInit = JSON.stringify(opts.body);
  }

  const res = await fetch(buildUrl(path, opts.query), {
    method,
    headers,
    body: bodyInit,
    signal: opts.signal,
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const parsed: unknown = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    const envelope =
      parsed && typeof parsed === 'object' && 'error' in parsed
        ? ((parsed as { error: ApiErrorEnvelope }).error)
        : { code: 'UNKNOWN', message: `Request failed (${res.status})` };
    throw new ApiError(res.status, envelope);
  }

  return parsed as T;
}

export const http = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) =>
    request<T>('GET', path, { query, signal }),
  post: <T>(path: string, body?: unknown, query?: Query) =>
    request<T>('POST', path, { body, query }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body }),
  del: <T>(path: string, query?: Query) => request<T>('DELETE', path, { query }),
};

/** Absolute URL for streaming endpoints (PDFs) that we open directly. */
export function apiUrl(path: string, query?: Query): string {
  return buildUrl(path, query);
}

/** Bearer token for direct fetches (e.g. authenticated PDF download). */
export async function bearerToken(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
