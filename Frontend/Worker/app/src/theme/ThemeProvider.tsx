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
import { applyDirection } from '../i18n/rtl';
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
  setLanguage: (lang: Language) => void;
  /** True once persisted prefs have been read (avoids a flash). */
  ready: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function seedThemeMode(): Theme {
  return Appearance.getColorScheme() === 'dark' ? Theme.DARK : Theme.LIGHT;
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

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    void saveLanguagePref(lang);
    void i18n.changeLanguage(toLocale(lang));
    applyDirection(lang);
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
