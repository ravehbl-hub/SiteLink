/**
 * Runtime config read from Expo public env (EXPO_PUBLIC_*).
 *
 * We do NOT fail-fast here (as the back end does) because the app must render a
 * clear "unconfigured" state in local dev rather than crash on boot. `isConfigured`
 * gates the real auth/API flow; when false the UI shows a setup notice.
 */
export interface AppConfig {
  apiBaseUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  isConfigured: boolean;
}

const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const config: AppConfig = {
  apiBaseUrl,
  supabaseUrl,
  supabaseAnonKey,
  isConfigured: Boolean(apiBaseUrl && supabaseUrl && supabaseAnonKey),
};
