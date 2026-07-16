/**
 * Theme + language context (DESIGN.md "Native"). Holds the active @sitelink/tokens
 * Theme object (lightTheme/darkTheme) and the active Language, seeds from
 * Appearance + persisted prefs, and persists user overrides. i18n direction is
 * applied on language change (RTL for Hebrew).
 */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance } from 'react-native';
import { lightTheme, darkTheme, type Theme as TokenTheme } from '@sitelink/tokens';
import { Language, Theme } from '@sitelink/shared';
import i18n, { toLocale } from '../i18n';
import { applyDirection, reloadForDirection } from '../i18n/rtl';
import {
  loadLanguagePref,
  loadThemePref,
  saveLanguagePref,
  saveThemePref,
} from '../lib/prefs';

interface ThemeContextValue {
  theme: TokenTheme;
  themeMode: Theme;
  language: Language;
  toggleTheme: () => void;
  setThemeMode: (mode: Theme) => void;
  /**
   * Change the active language. Persists the choice, then — if the writing
   * direction actually flips (e.g. en/tr ↔ he) — reloads the app so RTL/LTR
   * takes visual effect (drawer side + header/title alignment). Resolves to
   * true when a reload was triggered (the app is on its way down), false for a
   * same-direction change (en↔tr) where no reload is needed.
   */
  setLanguage: (lang: Language) => Promise<boolean>;
  /** True once persisted prefs have been read (avoids a flash). */
  ready: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Operations Deck is dark-first (tokens `defaultThemeName === 'dark'`): SiteLink
 * LEADS with dark. Seed DARK unless the system explicitly asks for light; an
 * explicit persisted user override still wins (applied after prefs load) and the
 * Settings toggle remains available.
 */
function seedThemeMode(): Theme {
  return Appearance.getColorScheme() === 'light' ? Theme.LIGHT : Theme.DARK;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeMode, setThemeModeState] = useState<Theme>(seedThemeMode);
  const [language, setLanguageState] = useState<Language>(Language.EN);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [storedTheme, storedLang] = await Promise.all([loadThemePref(), loadLanguagePref()]);
      if (!active) return;
      if (storedTheme) setThemeModeState(storedTheme);
      const lang = storedLang ?? Language.EN;
      setLanguageState(lang);
      await i18n.changeLanguage(toLocale(lang));
      applyDirection(lang);
      setReady(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  const setThemeMode = (mode: Theme) => {
    setThemeModeState(mode);
    void saveThemePref(mode);
  };

  const toggleTheme = () =>
    setThemeMode(themeMode === Theme.DARK ? Theme.LIGHT : Theme.DARK);

  const setLanguage = async (lang: Language): Promise<boolean> => {
    setLanguageState(lang);
    // Persist FIRST so the choice survives a reload and the app boots back up
    // in the chosen language + direction.
    await saveLanguagePref(lang);
    await i18n.changeLanguage(toLocale(lang));
    const directionChanged = applyDirection(lang);
    if (directionChanged) {
      // I18nManager.forceRTL only re-lays-out the app after a JS reload.
      await reloadForDirection();
      return true;
    }
    return false;
  };

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: themeMode === Theme.DARK ? darkTheme : lightTheme,
      themeMode,
      language,
      toggleTheme,
      setThemeMode,
      setLanguage,
      ready,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [themeMode, language, ready],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
