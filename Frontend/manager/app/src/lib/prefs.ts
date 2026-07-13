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
const DASH_VIEW_KEY = 'sitelink_dashboard_view';

export type DashboardView = 'data' | 'graphics';

export async function loadDashboardViewPref(): Promise<DashboardView | null> {
  const v = await SecureStore.getItemAsync(DASH_VIEW_KEY);
  return v === 'graphics' || v === 'data' ? v : null;
}

export async function saveDashboardViewPref(view: DashboardView): Promise<void> {
  await SecureStore.setItemAsync(DASH_VIEW_KEY, view);
}

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
