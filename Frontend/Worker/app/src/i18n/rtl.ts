/**
 * RTL application (Architecture §6 / DESIGN.md). Hebrew forces RTL via
 * I18nManager. Changing direction on native requires an app reload to fully
 * take effect; we allow the flag to be set at boot and expose a helper the
 * Settings screen calls after a language change.
 */
import { I18nManager } from 'react-native';
import { Language } from '@sitelink/shared';
import { isRtlLanguage } from './index';

/**
 * Sync the native layout direction to the active language.
 * Returns true if the direction actually changed (caller may prompt a reload).
 */
export function applyDirection(lang: Language): boolean {
  const shouldRtl = isRtlLanguage(lang);
  if (I18nManager.isRTL === shouldRtl) return false;
  I18nManager.allowRTL(shouldRtl);
  I18nManager.forceRTL(shouldRtl);
  return true;
}
