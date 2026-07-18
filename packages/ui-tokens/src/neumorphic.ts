/**
 * SiteLink — CREAM / TEAL NEUMORPHIC theme variant.
 *
 * ADDITIVE. This module introduces a NEW, opt-in visual theme for the manager
 * surface. It does NOT touch the Operations Deck tokens (color.ts / elevation.ts
 * / theme.ts) — the native apps and non-reskinned web stay on Deck until the user
 * approves the reskin. Nothing here changes `defaultThemeName` or any Deck value.
 *
 * The neumorphic look = soft, tactile "extruded plastic": every RAISED element
 * casts a dark drop shadow toward the bottom-right AND a light highlight toward
 * the top-left. INSET (pressed / active / inputs / wells) REVERSES both — a dark
 * inner shadow top-left, a light inner highlight bottom-right. On the warm cream
 * ground this reads as physical, pressable surfaces.
 *
 * Cross-platform: like the rest of the package, every shadow ships BOTH a web
 * `box-shadow` string (dual / comma-separated) AND a React Native approximation.
 * See `NativeNeumorphicShadow` for the RN limitation note.
 */

import type { ThemeColors } from "./color.js";
import type { ElevationSet, ElevationToken } from "./elevation.js";

/* ------------------------------------------------------------------ *
 * 1. Ramps — cream neutrals + teal, for both modes.
 * ------------------------------------------------------------------ */

/** Warm cream/sand neutral ramp (light-mode grounds & lines). */
export const cream = {
  50: "#F7F3EA",
  100: "#F5F0E6", // surface
  200: "#EBE4D6", // bg
  300: "#EAE3D5", // surface2
  400: "#D9D1C0", // line
  500: "#B8AF9C",
  600: "#928B7C", // muted
  700: "#6B655A",
  800: "#3B382F", // ink
  900: "#26241E",
} as const;

/** Teal ramp tuned for the neumorphic theme (deeper/greener than Deck teal). */
export const neuTeal = {
  50: "#E4EDEC",
  100: "#C3D8D5",
  200: "#8FBAB4",
  300: "#45B0A4", // dark bright
  400: "#2E827A", // bright
  500: "#1C5A55", // primary (light)
  600: "#256A63", // dark mid
  700: "#154440", // deep
  800: "#0E302D",
  900: "#081D1B",
} as const;

/* ------------------------------------------------------------------ *
 * 2. Semantic roles — reuse the shared ThemeColors shape so the CSS
 *    emitter and any Deck-shaped consumer resolve identical var names.
 *    Extra neumorphic-only accents (teal deep/bright) are exposed via
 *    `neumorphicAccents` below.
 * ------------------------------------------------------------------ */

/** LIGHT — the PRIMARY neumorphic mode (cream ground, teal accents). */
export const neumorphicLightColors: ThemeColors = {
  bg: "#EBE4D6",
  surface: "#F5F0E6",
  surfaceAlt: "#EAE3D5", // surface2 — inset wells, table headers
  border: "#D9D1C0", // line
  textPrimary: "#3B382F", // ink
  textSecondary: "#6B655A",
  textMuted: "#928B7C", // muted

  accent: "#1C5A55", // teal primary
  accentHover: "#154440", // teal deep
  onAccent: "#F5F0E6",
  accentSubtle: "#E4EDEC",

  success: "#2E6B4F",
  successSubtle: "#E4EFE7",
  warning: "#C79A5E", // amber
  warningSubtle: "#F5ECDC",
  danger: "#B85641", // error
  dangerSubtle: "#F4E3DE",
  info: "#2E827A", // teal bright doubles as info
  infoSubtle: "#E4EDEC",

  focusRing: "#2E827A", // teal bright

  // Neumorphism has a flat warm ground — no radial command-center gradient.
  bgGradientFrom: "#EBE4D6",
  bgGradientTo: "#EBE4D6",
};

/** DARK — muted teal-charcoal neumorphism. */
export const neumorphicDarkColors: ThemeColors = {
  bg: "#20282A",
  surface: "#252E30",
  surfaceAlt: "#1E2628", // surface2
  border: "#313B3C", // line
  textPrimary: "#E7E3D9", // ink
  textSecondary: "#B4B0A5",
  textMuted: "#8B958F", // muted

  accent: "#2E827A", // teal
  accentHover: "#256A63",
  onAccent: "#12191A",
  accentSubtle: "#22302E",

  success: "#45B0A4",
  successSubtle: "#1A2A28",
  warning: "#C79A5E",
  warningSubtle: "#2C2519",
  danger: "#C86A55",
  dangerSubtle: "#2C1E1A",
  info: "#45B0A4",
  infoSubtle: "#1A2A28",

  focusRing: "#45B0A4", // teal bright

  bgGradientFrom: "#20282A",
  bgGradientTo: "#20282A",
};

/**
 * Extra semantic accents unique to the neumorphic palette (the mockup calls out
 * three distinct teals). Exposed so a consumer can address teal-deep / teal-bright
 * directly; also emitted as CSS vars (`--sl-color-teal-*`).
 */
export interface NeumorphicAccents {
  tealPrimary: string;
  tealDeep: string;
  tealBright: string;
}

export const neumorphicLightAccents: NeumorphicAccents = {
  tealPrimary: "#1C5A55",
  tealDeep: "#154440",
  tealBright: "#2E827A",
};

export const neumorphicDarkAccents: NeumorphicAccents = {
  tealPrimary: "#2E827A",
  tealDeep: "#256A63",
  tealBright: "#45B0A4",
};

/* ------------------------------------------------------------------ *
 * 3. Dual-shadow neumorphic elevation.
 * ------------------------------------------------------------------ */

/**
 * Native cannot render a DUAL (dark + light) shadow, and it cannot render an
 * INSET shadow at all (RN shadow* / elevation are outer-only, single-color).
 *
 * LIMITATION: on React Native we approximate a RAISED element with the closest
 * single dark drop-shadow (bottom-right bias via shadowOffset) and DROP the light
 * top-left highlight; an INSET element cannot be shadowed natively, so native
 * consumers should fall back to a slightly darker `surfaceAlt` fill + a hairline
 * `border` to read "pressed/well". Native neumorphism is therefore APPROXIMATE —
 * the full dual/inset effect is web-only. (A pixel-true native effect would need
 * an SVG/gradient layer, which is out of scope for tokens.)
 */
export type NativeNeumorphicShadow = ElevationToken["native"] & {
  /**
   * True when this is an inset token that native CANNOT represent with shadows.
   * Native consumers should render `surfaceAlt` + `border` instead of a shadow.
   */
  insetUnsupportedOnNative?: boolean;
};

export interface NeumorphicShadowToken {
  /** Web `box-shadow` — dual, comma-separated (dark drop + light highlight). */
  web: string;
  /** Closest RN approximation (see NativeNeumorphicShadow limitation note). */
  native: NativeNeumorphicShadow;
}

/**
 * LIGHT dual shadows on the cream ground.
 * sd = warm dark rgba (bottom-right), sl = rgba(255,255,255,~0.65–0.75) (top-left).
 */
const SD = "rgba(58, 52, 40, 0.20)"; // warm dark
const SD_LG = "rgba(58, 52, 40, 0.26)";
const SL = "rgba(255, 255, 255, 0.70)"; // light highlight
const SL_LG = "rgba(255, 255, 255, 0.75)";

export interface NeumorphicElevationSet {
  /** Raised, subtle (chips, small controls). */
  raisedSm: NeumorphicShadowToken;
  /** Raised, default (cards, buttons, nav active). */
  raised: NeumorphicShadowToken;
  /** Raised, prominent (modals, popovers). */
  raisedLg: NeumorphicShadowToken;
  /** Inset, subtle (hover wells, small pressed controls). */
  insetSm: NeumorphicShadowToken;
  /** Inset, default (inputs, selects, pressed buttons, wells). */
  inset: NeumorphicShadowToken;
  /** Inset, prominent (deep sunken panels). */
  insetLg: NeumorphicShadowToken;
}

const nRaised = (
  color: string,
  y: number,
  opacity: number,
  radius: number,
  elevation: number,
): NativeNeumorphicShadow => ({
  shadowColor: color,
  shadowOffset: { width: 0, height: y },
  shadowOpacity: opacity,
  shadowRadius: radius,
  elevation,
});

const nInset = (): NativeNeumorphicShadow => ({
  // Native cannot inset-shadow; signal the fallback and keep a zeroed shadow.
  shadowColor: "#000000",
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0,
  shadowRadius: 0,
  elevation: 0,
  insetUnsupportedOnNative: true,
});

/**
 * LIGHT neumorphic elevation. Web strings are dual: a dark drop (bottom-right,
 * +x/+y) and a light highlight (top-left, -x/-y). Inset variants REVERSE both
 * with the `inset` keyword.
 */
export const neumorphicLightElevation: NeumorphicElevationSet = {
  raisedSm: {
    web: `3px 3px 6px ${SD}, -3px -3px 6px ${SL}`,
    native: nRaised("#3A3428", 2, 0.18, 4, 2),
  },
  raised: {
    web: `6px 6px 12px ${SD}, -6px -6px 12px ${SL}`,
    native: nRaised("#3A3428", 4, 0.2, 8, 4),
  },
  raisedLg: {
    web: `10px 10px 22px ${SD_LG}, -8px -8px 18px ${SL_LG}`,
    native: nRaised("#3A3428", 8, 0.24, 16, 8),
  },
  insetSm: {
    web: `inset 2px 2px 4px ${SD}, inset -2px -2px 4px ${SL}`,
    native: nInset(),
  },
  inset: {
    web: `inset 4px 4px 8px ${SD}, inset -4px -4px 8px ${SL}`,
    native: nInset(),
  },
  insetLg: {
    web: `inset 6px 6px 12px ${SD_LG}, inset -6px -6px 12px ${SL_LG}`,
    native: nInset(),
  },
};

/**
 * DARK neumorphic elevation. On the charcoal ground the dark shadow deepens and
 * the "highlight" is a low-alpha warm white; the effect is subtler than light.
 */
const D_SD = "rgba(0, 0, 0, 0.45)";
const D_SD_LG = "rgba(0, 0, 0, 0.55)";
const D_SL = "rgba(255, 255, 255, 0.05)";
const D_SL_LG = "rgba(255, 255, 255, 0.06)";

export const neumorphicDarkElevation: NeumorphicElevationSet = {
  raisedSm: {
    web: `3px 3px 6px ${D_SD}, -3px -3px 6px ${D_SL}`,
    native: nRaised("#000000", 2, 0.4, 4, 2),
  },
  raised: {
    web: `6px 6px 12px ${D_SD}, -6px -6px 12px ${D_SL}`,
    native: nRaised("#000000", 4, 0.45, 8, 4),
  },
  raisedLg: {
    web: `10px 10px 22px ${D_SD_LG}, -8px -8px 18px ${D_SL_LG}`,
    native: nRaised("#000000", 8, 0.55, 16, 8),
  },
  insetSm: {
    web: `inset 2px 2px 4px ${D_SD}, inset -2px -2px 4px ${D_SL}`,
    native: nInset(),
  },
  inset: {
    web: `inset 4px 4px 8px ${D_SD}, inset -4px -4px 8px ${D_SL}`,
    native: nInset(),
  },
  insetLg: {
    web: `inset 6px 6px 12px ${D_SD_LG}, inset -6px -6px 12px ${D_SL_LG}`,
    native: nInset(),
  },
};

/**
 * Map the neumorphic dual-shadow set onto the shared `ElevationSet` shape
 * (none/sm/md/lg) so the neumorphic theme still satisfies `Theme.elevation` and
 * any Deck-shaped consumer keeps working. Raised is the default elevation meaning
 * of sm/md/lg; the inset variants are addressed via `neumorphicLightElevation`.
 */
const toElevationSet = (n: NeumorphicElevationSet): ElevationSet => ({
  none: {
    web: "none",
    native: { shadowColor: "#000000", shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0, shadowRadius: 0, elevation: 0 },
  },
  sm: { web: n.raisedSm.web, native: n.raisedSm.native },
  md: { web: n.raised.web, native: n.raised.native },
  lg: { web: n.raisedLg.web, native: n.raisedLg.native },
});

export const neumorphicLightElevationSet: ElevationSet = toElevationSet(
  neumorphicLightElevation,
);
export const neumorphicDarkElevationSet: ElevationSet = toElevationSet(
  neumorphicDarkElevation,
);

/* ------------------------------------------------------------------ *
 * 4. Softer radii + uppercase-bold label treatment (neumorphic-only,
 *    additive — the base radii / textStyles are untouched).
 * ------------------------------------------------------------------ */

/**
 * Neumorphic radii — rounder than Deck. Cards 18–22, controls 11–14, pills full.
 * ADDITIVE: this is a separate scale; the base `radii` in spacing.ts is unchanged
 * so existing consumers are unaffected.
 */
export const neumorphicRadii = {
  none: 0,
  control: 12, // controls: 11–14 band, centered at 12
  controlLg: 14,
  chip: 999, // chips/pills full
  card: 20, // cards: 18–22 band, centered at 20
  cardLg: 22,
  well: 14, // inset input wells
  pill: 999,
} as const;

/**
 * Uppercase bold label treatment token — the signature small section-header/label
 * style: BOLD, UPPERCASE, widened tracking, muted color. Consumers apply
 * `textTransform: uppercase` only in Latin locales (Hebrew must NOT be
 * uppercased — see typography.ts letterSpacing note).
 */
export const neumorphicLabel = {
  size: 12,
  lineHeight: 16,
  weight: 700, // bold
  letterSpacing: 0.1, // em — a touch wider than the base label (0.08)
  textTransform: "uppercase" as const,
  role: "muted" as const, // resolve against textMuted / textSecondary
} as const;

export type NeumorphicRadiusToken = keyof typeof neumorphicRadii;
