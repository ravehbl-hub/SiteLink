/// <reference types="expo/types" />

/**
 * Ambient typing for the Expo public env (EXPO_PUBLIC_*). Expo inlines these at
 * build time via `process.env`. Declared here so config.ts typechecks without
 * pulling in full Node types.
 */
declare const process: {
  env: {
    EXPO_PUBLIC_API_BASE_URL?: string;
    EXPO_PUBLIC_SUPABASE_URL?: string;
    EXPO_PUBLIC_SUPABASE_ANON_KEY?: string;
    [key: string]: string | undefined;
  };
};
