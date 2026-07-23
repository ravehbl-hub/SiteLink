/**
 * Platform-aware key/value storage.
 *
 * Native (iOS/Android): expo-secure-store (encrypted, survives restarts).
 * Web: window.localStorage — SecureStore is native-only and, when called in a
 * browser, its promises never settle, which would hang app bootstrap (e.g. the
 * Supabase session load) on an infinite spinner. Using localStorage on web keeps
 * auth/session + prefs working there.
 *
 * SecureStore keys allow only [A-Za-z0-9._-] (and '.' is unreliable), so keys are
 * sanitized to a safe, stable form on both platforms.
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const isWeb = Platform.OS === 'web';

function sanitize(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export async function kvGet(key: string): Promise<string | null> {
  const k = sanitize(key);
  if (isWeb) return typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null;
  return SecureStore.getItemAsync(k);
}

export async function kvSet(key: string, value: string): Promise<void> {
  const k = sanitize(key);
  if (isWeb) {
    if (typeof localStorage !== 'undefined') localStorage.setItem(k, value);
    return;
  }
  await SecureStore.setItemAsync(k, value);
}

export async function kvDelete(key: string): Promise<void> {
  const k = sanitize(key);
  if (isWeb) {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(k);
    return;
  }
  await SecureStore.deleteItemAsync(k);
}
