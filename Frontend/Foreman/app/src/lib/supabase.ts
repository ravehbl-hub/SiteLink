/**
 * Supabase client (Architecture §5). Authentication is owned by Supabase Auth;
 * the SDK persists the session in expo-secure-store so tokens survive app restarts.
 * The Fastify back end verifies the Supabase JWT and owns authorization.
 *
 * When the app is unconfigured (local dev without env), `supabase` is null and the
 * UI surfaces a clear setup state instead of crashing.
 */
import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from './config';
import { kvGet, kvSet, kvDelete } from './kvStore';

/**
 * Platform-aware storage adapter for the Supabase session: SecureStore on native,
 * localStorage on web (SecureStore is native-only — on web its promises never settle
 * and would hang the session load on an infinite spinner). See kvStore.
 */
const authStorage = {
  getItem: (key: string) => kvGet(key),
  setItem: (key: string, value: string) => kvSet(key, value),
  removeItem: (key: string) => kvDelete(key),
};

export const supabase: SupabaseClient | null = config.isConfigured
  ? createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        storage: authStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;
