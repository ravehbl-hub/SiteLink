/**
 * SiteLink theme assembly.
 *
 * A `Theme` bundles the per-mode color + elevation values with the mode-agnostic
 * `tokens` (spacing/typography/radii/borders/sizing) that are identical across
 * light and dark. Web resolves a theme via a `data-theme` attribute; native
 * resolves it via a theme context/provider (see docs/DESIGN.md).
 */

import {
  lightColors,
  darkColors,
  glow,
  type ThemeColors,
  type GlowSet,
  ramps,
} from "./color.js";
import {
  fontFamily,
  fontFamilyNative,
  fontWeight,
  fontSize,
  lineHeight,
  letterSpacing,
  textStyles,
} from "./typography.js";
import { spacing, spacingCompact, radii, borderWidth, sizing } from "./spacing.js";
import {
  lightElevation,
  darkElevation,
  type ElevationSet,
} from "./elevation.js";
import {
  neumorphicLightColors,
  neumorphicDarkColors,
  neumorphicLightElevationSet,
  neumorphicDarkElevationSet,
  neumorphicLightElevation,
  neumorphicDarkElevation,
  neumorphicLightAccents,
  neumorphicDarkAccents,
  neumorphicRadii,
  neumorphicLabel,
  type NeumorphicElevationSet,
  type NeumorphicAccents,
} from "./neumorphic.js";

/** Mode-agnostic tokens — the same in every theme. */
export const tokens = {
  spacing,
  spacingCompact,
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

export type ThemeName =
  | "light"
  | "dark"
  | "neumorphicLight"
  | "neumorphicDark";

export interface Theme {
  name: ThemeName;
  /** True for dark mode — handy for status bars, image treatments, etc. */
  isDark: boolean;
  colors: ThemeColors;
  elevation: ElevationSet;
  /** Operations Deck teal-glow / live-status glow (shared across themes). */
  glow: GlowSet;
  tokens: Tokens;
  /**
   * Present ONLY on the neumorphic variants. Carries the dual/inset shadow set,
   * the extra teal accents, the softer radii and the uppercase-bold label token
   * so a consumer that opts into neumorphism gets the full signature treatment.
   * Undefined on the Deck themes (light/dark) — additive, non-breaking.
   */
  neumorphic?: {
    shadows: NeumorphicElevationSet;
    accents: NeumorphicAccents;
    radii: typeof neumorphicRadii;
    label: typeof neumorphicLabel;
  };
}

export const lightTheme: Theme = {
  name: "light",
  isDark: false,
  colors: lightColors,
  elevation: lightElevation,
  glow,
  tokens,
};

export const darkTheme: Theme = {
  name: "dark",
  isDark: true,
  colors: darkColors,
  elevation: darkElevation,
  glow,
  tokens,
};

/**
 * NEUMORPHIC (Cream / Teal) — the new, opt-in manager theme. ADDITIVE: this does
 * not replace Deck. A consumer selects it explicitly (web: data-theme, native:
 * pass this Theme to the provider). See docs/NEUMORPHIC.md.
 */
export const neumorphicLightTheme: Theme = {
  name: "neumorphicLight",
  isDark: false,
  colors: neumorphicLightColors,
  elevation: neumorphicLightElevationSet,
  glow,
  tokens,
  neumorphic: {
    shadows: neumorphicLightElevation,
    accents: neumorphicLightAccents,
    radii: neumorphicRadii,
    label: neumorphicLabel,
  },
};

export const neumorphicDarkTheme: Theme = {
  name: "neumorphicDark",
  isDark: true,
  colors: neumorphicDarkColors,
  elevation: neumorphicDarkElevationSet,
  glow,
  tokens,
  neumorphic: {
    shadows: neumorphicDarkElevation,
    accents: neumorphicDarkAccents,
    radii: neumorphicRadii,
    label: neumorphicLabel,
  },
};

export const themes: Record<ThemeName, Theme> = {
  light: lightTheme,
  dark: darkTheme,
  neumorphicLight: neumorphicLightTheme,
  neumorphicDark: neumorphicDarkTheme,
};

/**
 * The PRIMARY theme for the product. Direction 03 "Operations Deck" is
 * dark-first: SiteLink now LEADS with dark. Surfaces should seed their initial
 * theme from this (still honoring an explicit user/system override).
 */
export const defaultThemeName: ThemeName = "dark";
export const defaultTheme: Theme = themes[defaultThemeName];

export function getTheme(name: ThemeName = defaultThemeName): Theme {
  return themes[name];
}
