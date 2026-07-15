/**
 * Supabase browser client (Architecture §5.1). Owns authentication: sign-in,
 * session persistence + refresh. The client attaches the resulting access token
 * as a Bearer to the SiteLink back end (see lib/api/client.ts).
 *
 * When Supabase is not configured (local dev without a project) we return null;
 * the AuthProvider then renders an explicit "not configured" state.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env, isSupabaseConfigured } from '../env';

let cached: SupabaseClient | null | undefined;

export function getSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  cached = isSupabaseConfigured
    ? createClient(env.supabaseUrl, env.supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null;
  return cached;
}
