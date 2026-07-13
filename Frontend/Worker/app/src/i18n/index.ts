/**
 * i18n setup (Architecture §6). Three locales: he (RTL), en, tr (LTR).
 * All UI strings are keyed here — no hard-coded strings in screens.
 * RTL is applied at app boot via I18nManager (see src/i18n/rtl.ts).
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { Language } from '@sitelink/shared';
import { en } from './locales/en';
import { he } from './locales/he';
import { tr } from './locales/tr';

export const DEFAULT_LANGUAGE = Language.EN;

/** Map the persisted Language enum to the i18next locale code. */
export function toLocale(lang: Language): 'en' | 'he' | 'tr' {
  switch (lang) {
    case Language.HE:
      return 'he';
    case Language.TR:
      return 'tr';
    default:
      return 'en';
  }
}

export function fromLocale(code: string): Language {
  switch (code) {
    case 'he':
      return Language.HE;
    case 'tr':
      return Language.TR;
    default:
      return Language.EN;
  }
}

/** Hebrew is the only RTL locale. */
export function isRtlLanguage(lang: Language): boolean {
  return lang === Language.HE;
}

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    compatibilityJSON: 'v3',
    resources: {
      en: { translation: en },
      he: { translation: he },
      tr: { translation: tr },
    },
    lng: toLocale(DEFAULT_LANGUAGE),
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}

export default i18n;
