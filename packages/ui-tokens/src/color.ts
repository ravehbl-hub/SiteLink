/**
 * SiteLink color tokens.
 *
 * Brand source: the SiteLink logo — a single teal wordmark with a crane and
 * construction workers. Core brand teal ~#1F7A82, deeper teal-black ink ~#12343B,
 * lighter secondary teal ~#5AA0A6. The palette is derived from this teal: an
 * industrial, professional feel — restrained, not flashy.
 *
 * This file is framework-agnostic: plain typed JS objects that both the React web
 * app (via CSS variables emitted from these values) and the React Native app
 * (via the JS token object) consume.
 */

/** A perceptual ramp (50 lightest -> 900 darkest) for a single hue. */
export interface ColorRamp {
  50: string;
  100: string;
  200: string;
  300: string;
  400: string;
  500: string;
  600: string;
  700: string;
  800: string;
  900: string;
}

/**
 * Brand teal ramp. 500/600 sit around the logo teal (#1F7A82); 800/900 approach
 * the deep teal-black ink (#12343B); 300 is the lighter secondary teal (#5AA0A6).
 */
export const teal: ColorRamp = {
  50: "#E9F3F4",
  100: "#CBE3E5",
  200: "#A3CDD1",
  300: "#5AA0A6", // secondary teal (from brief)
  400: "#3A8B92",
  500: "#1F7A82", // core brand teal (from brief)
  600: "#1A6A71",
  700: "#155860",
  800: "#12343B", // deep teal-black ink (from brief)
  900: "#0C2429",
};

/**
 * Neutrals — intentionally teal-biased (a cool, desaturated slate) rather than
 * pure grey, so surfaces feel of a piece with the brand teal.
 */
export const neutral: ColorRamp = {
  50: "#F4F7F7",
  100: "#E7EDED",
  200: "#D0DADB",
  300: "#AEBDBE",
  400: "#83979A",
  500: "#5E7275",
  600: "#465759",
  700: "#334143",
  800: "#212C2E",
  900: "#141B1D",
};

/** Semantic hue ramps — deliberately distinct from the teal accent. */

export const green: ColorRamp = {
  50: "#E8F6EE",
  100: "#C6E9D4",
  200: "#95D6AF",
  300: "#5FC088",
  400: "#33A868",
  500: "#1E8E52", // success base
  600: "#177544",
  700: "#125C36",
  800: "#0E4429",
  900: "#082C1B",
};

export const amber: ColorRamp = {
  50: "#FDF4E3",
  100: "#F9E3B8",
  200: "#F3CB7E",
  300: "#EAAE43",
  400: "#DF941C",
  500: "#C57C0A", // warning base
  600: "#A06408",
  700: "#7C4D07",
  800: "#5A3805",
  900: "#3A2403",
};

export const red: ColorRamp = {
  50: "#FCECEC",
  100: "#F7CFCF",
  200: "#EFA5A5",
  300: "#E37373",
  400: "#D64848",
  500: "#C22F2F", // danger base
  600: "#A12626",
  700: "#7E1F1F",
  800: "#5C1717",
  900: "#3B0F0F",
};

export const blue: ColorRamp = {
  50: "#E9F1FA",
  100: "#C7DCF3",
  200: "#98BFE8",
  300: "#639FDB",
  400: "#3B82CC",
  500: "#2569B4", // info base
  600: "#1D5493",
  700: "#174172",
  800: "#112F53",
  900: "#0B1E36",
};

/**
 * Semantic roles resolved for a given theme. Each status has a strong base color
 * (for icons/borders/text) and a subtle background (for chips/rows/banners).
 */
export interface ThemeColors {
  /** App background (page). */
  bg: string;
  /** Primary raised surface (cards, sheets, nav). */
  surface: string;
  /** Secondary surface (inset areas, table headers, subtle panels). */
  surfaceAlt: string;
  /** Hairline borders / dividers. */
  border: string;
  /** Primary text / high-emphasis foreground. */
  textPrimary: string;
  /** Secondary text / medium-emphasis foreground. */
  textSecondary: string;
  /** Disabled / low-emphasis foreground. */
  textMuted: string;

  /** Brand accent (primary actions, active states, links). */
  accent: string;
  /** Accent hover/pressed. */
  accentHover: string;
  /** Foreground placed on top of `accent`. */
  onAccent: string;
  /** Very subtle accent-tinted background (selected rows, focus surfaces). */
  accentSubtle: string;

  success: string;
  successSubtle: string;
  warning: string;
  warningSubtle: string;
  danger: string;
  dangerSubtle: string;
  info: string;
  infoSubtle: string;

  /** Focus ring color (accessible outline). */
  focusRing: string;

  /**
   * Operations Deck ground. The app background reads as a radial "command-center"
   * gradient from `bgGradientFrom` (center/top) to `bgGradientTo` (edges). In
   * flat contexts fall back to `bg`. In light mode these can equal `bg`.
   */
  bgGradientFrom: string;
  bgGradientTo: string;
}

/**
 * LIGHT = the calmer/flatter Operations Deck variant.
 *
 * On the near-white ground the fully-saturated brand/semantic ramps read hot, so
 * the light accent + semantics + the data-viz colors the dashboard charts pick up
 * (`accent`/`success`/`warning`/`danger`/`info` — see the manager web charts) are
 * DESATURATED toward the teal-biased slate: pulled toward neutral while keeping
 * AA contrast on white. Calmer and professional, not washed-out. (DARK keeps its
 * vivid, glowing values — see `darkColors`.)
 */
export const lightColors: ThemeColors = {
  bg: neutral[50],
  surface: "#FFFFFF",
  surfaceAlt: neutral[100],
  border: neutral[200],
  textPrimary: teal[800],
  textSecondary: neutral[600],
  textMuted: neutral[400],

  // Accent: muted teal (was teal[500] #1F7A82 / hover teal[600] #1A6A71).
  // Grayer, less electric on white; still clearly the brand teal + AA on white.
  accent: "#2C6B71",
  accentHover: "#245A5F",
  onAccent: "#FFFFFF",
  accentSubtle: teal[50],

  // Semantics: desaturated toward slate. Bases were the fully-saturated *[600];
  // these keep hue identity + AA contrast on white but drop the neon edge so the
  // chart bars/donut read calmer in light mode.
  success: "#2F6B48", // was green[600] #177544
  successSubtle: green[50],
  warning: "#8A5E1E", // was amber[600] #A06408
  warningSubtle: amber[50],
  danger: "#9A3838", // was red[600] #A12626
  dangerSubtle: red[50],
  info: "#345E88", // was blue[600] #1D5493
  infoSubtle: blue[50],

  focusRing: teal[400],

  // Light mode is flat — the gradient collapses onto the base bg.
  bgGradientFrom: neutral[50],
  bgGradientTo: neutral[50],
};

/**
 * DARK = the primary theme (Direction 03 "Operations Deck").
 *
 * A dark-first command center: a deep teal-black ground with a radial gradient
 * (#12343B center -> #0A1618 edges), teal-bordered panels, teal used ONLY for
 * accent/data/active state (see `glowAccent`), and a brighter "live" green.
 * Status colors stay outside teal and are expected to be encoded in FORM
 * (pills/dots/stripes) as well as color.
 */
export const darkColors: ThemeColors = {
  bg: "#0A1618", // deep teal-black ground
  surface: "#0e1e22", // panel
  surfaceAlt: "#12262b", // raised / inset panel
  border: "#21454c", // teal hairline border
  textPrimary: "#EAF2F2",
  textSecondary: "#7F9BA0",
  textMuted: "#8FA6A9",

  accent: "#5AA0A6", // teal glow accent
  accentHover: "#3A8B92",
  onAccent: teal[900], // #0C2429 — dark ink on the teal fill
  accentSubtle: "#12262b", // teal-tinted panel wash for selected/active surfaces

  success: "#3ED8A0", // brighter "live" green
  successSubtle: "#0E2A1C",
  warning: amber[300], // #EAAE43 — bright amber on dark
  warningSubtle: "#2E220C",
  danger: red[300], // #E37373 — bright red on dark
  dangerSubtle: "#2E1414",
  info: blue[300], // #639FDB
  infoSubtle: "#12233A",

  focusRing: "#5AA0A6",

  // Radial command-center ground: #12343B center -> #0A1618 edges.
  bgGradientFrom: "#12343B",
  bgGradientTo: "#0A1618",
};

/**
 * Operations Deck glow tokens — the teal accent glow used ONLY for
 * data/charts/active state, plus a "live"/status glow (green). Both ship as web
 * `box-shadow` strings and RN-friendly primitives (color + radius) so native can
 * approximate the glow. Emitted as CSS vars (`--sl-glow-*`) for web.
 */
export interface GlowToken {
  /** Web `box-shadow` value (a 1px teal ring + soft outer glow). */
  web: string;
  /** The core glow color (for RN shadowColor / borderColor tints). */
  color: string;
}

export interface GlowSet {
  /** Teal accent glow — active tiles, focused charts, selected KPI cards. */
  accent: GlowToken;
  /** "Live" / healthy status glow (green) — live indicators, online pills. */
  live: GlowToken;
}

export const glow: GlowSet = {
  accent: {
    web: "0 0 0 1px #2f5b5c, 0 8px 24px -8px rgba(58, 139, 146, 0.5)",
    color: "#3A8B92",
  },
  live: {
    web: "0 0 0 1px #1c5a45, 0 6px 20px -8px rgba(62, 216, 160, 0.45)",
    color: "#3ED8A0",
  },
};

/** Raw ramps, exported for edge cases (charts, data-viz) that need scale access. */
export const ramps = { teal, neutral, green, amber, red, blue } as const;
