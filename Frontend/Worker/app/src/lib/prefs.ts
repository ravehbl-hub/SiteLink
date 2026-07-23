/**
 * Local persistence of UI preferences (theme + language) via expo-secure-store.
 * These persist across sessions/devices per FR-X-THEME-2 / FR-X-I18N-3. Server-side
 * User.theme/language remain the source of truth; these are the fast local cache
 * seeded from /auth/me and updated on toggle.
 */
import { kvGet, kvSet } from './kvStore';
import { Language, Theme } from '@sitelink/shared';

const THEME_KEY = 'sitelink_worker_theme';
const LANG_KEY = 'sitelink_worker_language';

export async function loadThemePref(): Promise<Theme | null> {
  const v = await kvGet(THEME_KEY);
  return v === Theme.DARK || v === Theme.LIGHT ? (v as Theme) : null;
}

export async function saveThemePref(theme: Theme): Promise<void> {
  await kvSet(THEME_KEY, theme);
}

export async function loadLanguagePref(): Promise<Language | null> {
  const v = await kvGet(LANG_KEY);
  return v === Language.HE || v === Language.EN || v === Language.TR ? (v as Language) : null;
}

export async function saveLanguagePref(lang: Language): Promise<void> {
  await kvSet(LANG_KEY, lang);
}
