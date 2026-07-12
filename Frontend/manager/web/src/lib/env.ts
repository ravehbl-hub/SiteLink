/**
 * Client env surface (Architecture §8). Reads VITE_* vars, fails soft:
 * when Supabase/back end are not configured we surface a clear "unconfigured"
 * state for local dev rather than crashing (per build brief).
 */
export const env = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '',
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? '',
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
};

/** True only when both Supabase publishable values are present. */
export const isSupabaseConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey);

/** True when the back-end base URL is configured. */
export const isApiConfigured = Boolean(env.apiBaseUrl);
