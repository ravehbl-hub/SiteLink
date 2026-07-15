/**
 * i18n setup (Architecture §6, FR-X-I18N). Locales he (RTL), en, tr (LTR).
 * All display strings come from resources; no hard-coded text (FR-X-I18N-4).
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { Language } from '@sitelink/shared';
import { en } from './en';
import { he } from './he';
import { tr } from './tr';

export const LOCALES = ['en', 'he', 'tr'] as const;
export type Locale = (typeof LOCALES)[number];

const STORAGE_KEY = 'sitelink.language';

/** Map the shared Language enum to an i18next locale code and back. */
export function localeFromEnum(lang: Language): Locale {
  return lang === Language.HE ? 'he' : lang === Language.TR ? 'tr' : 'en';
}
export function enumFromLocale(locale: Locale): Language {
  return locale === 'he' ? Language.HE : locale === 'tr' ? Language.TR : Language.EN;
}

export function dirForLocale(locale: string): 'rtl' | 'ltr' {
  return locale === 'he' ? 'rtl' : 'ltr';
}

/** Reflect the active locale onto <html> dir + lang (FR-X-I18N-2). */
export function applyDocumentDirection(locale: string): void {
  const dir = dirForLocale(locale);
  document.documentElement.setAttribute('dir', dir);
  document.documentElement.setAttribute('lang', locale);
}

function initialLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY) as Locale | null;
  if (stored && LOCALES.includes(stored)) return stored;
  const nav = navigator.language.slice(0, 2);
  return (LOCALES as readonly string[]).includes(nav) ? (nav as Locale) : 'en';
}

const startLocale = initialLocale();

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    he: { translation: he },
    tr: { translation: tr },
  },
  lng: startLocale,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

applyDocumentDirection(startLocale);

export function setLocale(locale: Locale): void {
  localStorage.setItem(STORAGE_KEY, locale);
  void i18n.changeLanguage(locale);
  applyDocumentDirection(locale);
}

export default i18n;
