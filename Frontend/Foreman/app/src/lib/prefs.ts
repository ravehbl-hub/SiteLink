/**
 * Local persistence of UI preferences (theme + language) via expo-secure-store.
 * These persist across sessions/devices per FR-X-THEME-2 / FR-X-I18N-3. Server-side
 * User.theme/language remain the source of truth; these are the fast local cache
 * seeded from /auth/me and updated on toggle.
 */
import * as SecureStore from 'expo-secure-store';
import { Language, Theme } from '@sitelink/shared';

const THEME_KEY = 'sitelink_theme';
const LANG_KEY = 'sitelink_language';
const ACTIVE_SITE_KEY = 'sitelink_foreman_active_site';

export async function loadThemePref(): Promise<Theme | null> {
  const v = await SecureStore.getItemAsync(THEME_KEY);
  return v === Theme.DARK || v === Theme.LIGHT ? (v as Theme) : null;
}

export async function saveThemePref(theme: Theme): Promise<void> {
  await SecureStore.setItemAsync(THEME_KEY, theme);
}

export async function loadLanguagePref(): Promise<Language | null> {
  const v = await SecureStore.getItemAsync(LANG_KEY);
  return v === Language.HE || v === Language.EN || v === Language.TR ? (v as Language) : null;
}

export async function saveLanguagePref(lang: Language): Promise<void> {
  await SecureStore.setItemAsync(LANG_KEY, lang);
}

/**
 * The Foreman's last-selected active site id (multi-site picker). Local-only cache:
 * the server derives/validates a foreman's scope union on every request, so this is
 * purely which of their sites the UI is currently pointed at. On launch we restore
 * it and — if it is no longer in the union (unassigned since) — fall back to the
 * primary/first available (see ActiveSiteProvider).
 */
export async function loadActiveSitePref(): Promise<string | null> {
  const v = await SecureStore.getItemAsync(ACTIVE_SITE_KEY);
  return v && v.length > 0 ? v : null;
}

export async function saveActiveSitePref(siteId: string): Promise<void> {
  await SecureStore.setItemAsync(ACTIVE_SITE_KEY, siteId);
}

export async function clearActiveSitePref(): Promise<void> {
  await SecureStore.deleteItemAsync(ACTIVE_SITE_KEY);
}
