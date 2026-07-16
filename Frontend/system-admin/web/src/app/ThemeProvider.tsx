/**
 * Theme provider (DESIGN "Theming approach", FR-X-THEME). Sets data-theme on
 * <html>; all --sl-* CSS variables update instantly. Operations Deck is DARK-FIRST:
 * with no persisted choice the app seeds to DARK (matching the token default on
 * :root). Persists the user choice and applies before paint to avoid a flash
 * (FR-X-THEME-2). The toggle + persisted choice keep working.
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

type Mode = 'light' | 'dark';
const STORAGE_KEY = 'sitelink.theme';

interface ThemeContextValue {
  mode: Mode;
  setMode: (mode: Mode) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function initialMode(): Mode {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  // Dark-first default (Operations Deck). No persisted choice → DARK.
  return 'dark';
}

function applyMode(mode: Mode): void {
  document.documentElement.setAttribute('data-theme', mode);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<Mode>(initialMode);

  useEffect(() => {
    applyMode(mode);
  }, [mode]);

  const setMode = useCallback((next: Mode) => {
    localStorage.setItem(STORAGE_KEY, next);
    setModeState(next);
  }, []);

  const toggle = useCallback(
    () => setMode(mode === 'dark' ? 'light' : 'dark'),
    [mode, setMode],
  );

  return (
    <ThemeContext.Provider value={{ mode, setMode, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
