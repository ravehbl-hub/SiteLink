/**
 * SiteLink typography tokens.
 *
 * Two roles:
 *  - `display`: a strong industrial / grotesque face for headings, KPIs and
 *    uppercase labels — conveys the construction, engineered feel.
 *  - `body`: a clean, highly legible grotesque for UI text and long content.
 *
 * i18n note: Hebrew and Turkish must render correctly. We therefore lead with
 * system-safe stacks (Segoe UI, San Francisco, Roboto, Noto) that ship broad
 * Latin + Hebrew coverage on every target OS, and NAME an optional face
 * ("Archivo" for display, "Inter" for body) that the app may self-host — but we
 * never depend on a CDN. If the named face is absent the stack degrades cleanly.
 */

/** Font-family stacks (as strings ready for CSS `font-family` / RN `fontFamily`). */
export const fontFamily = {
  /**
   * Industrial/grotesque display. "Archivo" is the intended self-hosted face;
   * it covers Latin + Turkish. For Hebrew headings the stack falls through to
   * the platform Hebrew UI faces before generic sans-serif.
   */
  display:
    '"Archivo", "Segoe UI", -apple-system, BlinkMacSystemFont, "Roboto", "Noto Sans", "Noto Sans Hebrew", "Helvetica Neue", Arial, sans-serif',
  /** Clean body. "Inter" is the intended self-hosted face; broad coverage. */
  body:
    '"Inter", "Segoe UI", -apple-system, BlinkMacSystemFont, "Roboto", "Noto Sans", "Noto Sans Hebrew", "Helvetica Neue", Arial, sans-serif',
  /** Monospace for IDs, coordinates, timesheets. */
  mono:
    'ui-monospace, SFMono-Regular, "SF Mono", "Roboto Mono", "Noto Sans Mono", Menlo, Consolas, monospace',
} as const;

/**
 * React Native cannot parse a CSS font stack — it needs a single family name and
 * relies on OS fallback. These are the names to register/link on native; if the
 * bundled font is unavailable RN falls back to the system default automatically.
 */
export const fontFamilyNative = {
  display: "Archivo",
  body: "Inter",
  mono: "monospace",
} as const;

export const fontWeight = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
} as const;

/** Type scale. `size`/`lineHeight` are in px (unitless-friendly for both webs). */
export interface TypeStep {
  size: number;
  lineHeight: number;
  weight: number;
}

export const fontSize = {
  xs: 12,
  sm: 14,
  base: 16,
  md: 18,
  lg: 20,
  xl: 24,
  "2xl": 30,
  "3xl": 36,
  "4xl": 46,
} as const;

export const lineHeight = {
  tight: 1.2,
  snug: 1.35,
  normal: 1.5,
  relaxed: 1.65,
} as const;

/** Named text roles with concrete size/line-height/weight for direct use. */
export const textStyles = {
  displayLg: { size: 46, lineHeight: 55, weight: fontWeight.extrabold },
  displayMd: { size: 36, lineHeight: 43, weight: fontWeight.bold },
  h1: { size: 30, lineHeight: 38, weight: fontWeight.bold },
  h2: { size: 24, lineHeight: 32, weight: fontWeight.semibold },
  h3: { size: 20, lineHeight: 28, weight: fontWeight.semibold },
  bodyLg: { size: 18, lineHeight: 28, weight: fontWeight.regular },
  body: { size: 16, lineHeight: 24, weight: fontWeight.regular },
  bodySm: { size: 14, lineHeight: 21, weight: fontWeight.regular },
  caption: { size: 12, lineHeight: 16, weight: fontWeight.medium },
  /** Uppercase eyebrow/label — use with `letterSpacing.label`. */
  label: { size: 12, lineHeight: 16, weight: fontWeight.semibold },
} as const satisfies Record<string, TypeStep>;

/**
 * Letter-spacing tokens (em units). `label` widens tracking for uppercase
 * eyebrow labels; RTL scripts (Hebrew) should NOT be uppercased, so apply the
 * uppercase transform + `label` tracking only to Latin-locale labels.
 */
export const letterSpacing = {
  tight: -0.01,
  normal: 0,
  label: 0.08,
} as const;

export type FontFamilyToken = keyof typeof fontFamily;
export type TextStyleToken = keyof typeof textStyles;
