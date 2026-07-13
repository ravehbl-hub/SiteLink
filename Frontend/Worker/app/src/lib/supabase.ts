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
import * as SecureStore from 'expo-secure-store';
import { config } from './config';

/**
 * SecureStore-backed storage adapter for the Supabase session. SecureStore keys
 * cannot contain '.', so we sanitize the key the SDK passes in.
 */
const secureStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(sanitize(key)),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(sanitize(key), value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(sanitize(key)),
};

function sanitize(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\./g, '_');
}

export const supabase: SupabaseClient | null = config.isConfigured
  ? createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        storage: secureStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;
