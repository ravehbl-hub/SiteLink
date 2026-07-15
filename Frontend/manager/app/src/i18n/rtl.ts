/**
 * RTL application (Architecture §6 / DESIGN.md). Hebrew forces RTL via
 * I18nManager. Changing direction on native does NOT re-lay-out the running
 * app — I18nManager.forceRTL only takes effect after a full JS reload. We apply
 * the flag at boot (from the persisted locale, before nav renders) and, when the
 * user changes language and the direction actually flips, reload the app so the
 * drawer/header/titles pick up the new direction. See reloadForDirection().
 */
import { I18nManager, DevSettings } from 'react-native';
import { Language } from '@sitelink/shared';
import { isRtlLanguage } from './index';

/**
 * Sync the native layout direction to the active language.
 * Returns true if the direction actually changed (caller must reload — see
 * reloadForDirection — for the change to take visual effect on native).
 */
export function applyDirection(lang: Language): boolean {
  const shouldRtl = isRtlLanguage(lang);
  if (I18nManager.isRTL === shouldRtl) return false;
  I18nManager.allowRTL(shouldRtl);
  I18nManager.forceRTL(shouldRtl);
  return true;
}

/**
 * Reload the running app so a just-applied I18nManager direction change actually
 * re-lays-out the UI (drawer side + item/header/title alignment). Only call this
 * AFTER the new language has been persisted, so the app comes back up in the
 * chosen language + direction.
 *
 * Prefers expo-updates reloadAsync() (production/standalone). In dev, where
 * expo-updates cannot reload the JS bundle, falls back to DevSettings.reload().
 */
export async function reloadForDirection(): Promise<void> {
  try {
    // Lazy require so a missing/partial expo-updates in some environments does
    // not crash the module at import time.
    const Updates = require('expo-updates') as typeof import('expo-updates');
    await Updates.reloadAsync();
    return;
  } catch {
    // Fall through to the dev reload path below.
  }
  if (typeof DevSettings?.reload === 'function') {
    DevSettings.reload();
  }
}
