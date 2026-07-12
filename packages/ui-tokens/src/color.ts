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
}

export const lightColors: ThemeColors = {
  bg: neutral[50],
  surface: "#FFFFFF",
  surfaceAlt: neutral[100],
  border: neutral[200],
  textPrimary: teal[800],
  textSecondary: neutral[600],
  textMuted: neutral[400],

  accent: teal[500],
  accentHover: teal[600],
  onAccent: "#FFFFFF",
  accentSubtle: teal[50],

  success: green[600],
  successSubtle: green[50],
  warning: amber[600],
  warningSubtle: amber[50],
  danger: red[600],
  dangerSubtle: red[50],
  info: blue[600],
  infoSubtle: blue[50],

  focusRing: teal[400],
};

export const darkColors: ThemeColors = {
  bg: neutral[900],
  surface: neutral[800],
  surfaceAlt: neutral[700],
  border: neutral[700],
  textPrimary: neutral[50],
  textSecondary: neutral[300],
  textMuted: neutral[500],

  accent: teal[300],
  accentHover: teal[200],
  onAccent: teal[900],
  accentSubtle: "#173238",

  success: green[300],
  successSubtle: "#0E2A1C",
  warning: amber[300],
  warningSubtle: "#2E220C",
  danger: red[300],
  dangerSubtle: "#2E1414",
  info: blue[300],
  infoSubtle: "#12233A",

  focusRing: teal[300],
};

/** Raw ramps, exported for edge cases (charts, data-viz) that need scale access. */
export const ramps = { teal, neutral, green, amber, red, blue } as const;
