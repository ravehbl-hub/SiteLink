/**
 * SiteLink theme assembly.
 *
 * A `Theme` bundles the per-mode color + elevation values with the mode-agnostic
 * `tokens` (spacing/typography/radii/borders/sizing) that are identical across
 * light and dark. Web resolves a theme via a `data-theme` attribute; native
 * resolves it via a theme context/provider (see docs/DESIGN.md).
 */

import { lightColors, darkColors, type ThemeColors, ramps } from "./color.js";
import {
  fontFamily,
  fontFamilyNative,
  fontWeight,
  fontSize,
  lineHeight,
  letterSpacing,
  textStyles,
} from "./typography.js";
import { spacing, radii, borderWidth, sizing } from "./spacing.js";
import {
  lightElevation,
  darkElevation,
  type ElevationSet,
} from "./elevation.js";

/** Mode-agnostic tokens — the same in every theme. */
export const tokens = {
  spacing,
  radii,
  borderWidth,
  sizing,
  fontFamily,
  fontFamilyNative,
  fontWeight,
  fontSize,
  lineHeight,
  letterSpacing,
  textStyles,
  ramps,
} as const;

export type Tokens = typeof tokens;

export type ThemeName = "light" | "dark";

export interface Theme {
  name: ThemeName;
  /** True for dark mode — handy for status bars, image treatments, etc. */
  isDark: boolean;
  colors: ThemeColors;
  elevation: ElevationSet;
  tokens: Tokens;
}

export const lightTheme: Theme = {
  name: "light",
  isDark: false,
  colors: lightColors,
  elevation: lightElevation,
  tokens,
};

export const darkTheme: Theme = {
  name: "dark",
  isDark: true,
  colors: darkColors,
  elevation: darkElevation,
  tokens,
};

export const themes: Record<ThemeName, Theme> = {
  light: lightTheme,
  dark: darkTheme,
};

export function getTheme(name: ThemeName): Theme {
  return themes[name];
}
