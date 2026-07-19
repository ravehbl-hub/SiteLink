/**
 * i18n setup for the marketing site. Locales: he (RTL, default), en, tr (LTR).
 * All display strings come from resources — no hard-coded copy in components.
 * Self-contained: uses plain 'he' | 'en' | 'tr' (no @sitelink/shared dependency).
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './en';
import { he } from './he';
import { tr } from './tr';

export const LOCALES = ['he', 'en', 'tr'] as const;
export type Locale = (typeof LOCALES)[number];

const STORAGE_KEY = 'sitelink.website.language';

export function dirForLocale(locale: string): 'rtl' | 'ltr' {
  return locale === 'he' ? 'rtl' : 'ltr';
}

/** Reflect the active locale onto <html> dir + lang. */
export function applyDocumentDirection(locale: string): void {
  document.documentElement.setAttribute('dir', dirForLocale(locale));
  document.documentElement.setAttribute('lang', locale);
}

function initialLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY) as Locale | null;
  if (stored && (LOCALES as readonly string[]).includes(stored)) return stored;
  return 'he';
}

const startLocale = initialLocale();

void i18n.use(initReactI18next).init({
  resources: {
    he: { translation: he },
    en: { translation: en },
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
