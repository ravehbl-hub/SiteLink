/**
 * SiteLink spacing, radii and border tokens.
 *
 * Direction-agnostic: values here express size only, never a physical side.
 * Consumers must apply them with LOGICAL properties so layouts mirror correctly
 * in RTL (Hebrew). On web use `margin-inline-start`, `padding-inline-end`, `inset-inline`,
 * `border-start-start-radius`, etc. On React Native use the logical style keys
 * (`marginStart`, `paddingEnd`, `start`, `end`) — never `left`/`right`.
 *
 * Scale is a 4px base grid.
 */

export const spacing = {
  "0": 0,
  px: 1,
  "0.5": 2,
  "1": 4,
  "1.5": 6,
  "2": 8,
  "3": 12,
  "4": 16,
  "5": 20,
  "6": 24,
  "8": 32,
  "10": 40,
  "12": 48,
  "16": 64,
  "20": 80,
  "24": 96,
} as const;

/**
 * Compact spacing scale — the Operations Deck "dense + calm" density.
 *
 * ADDITIVE: the base `spacing` scale is unchanged so existing layouts on all
 * surfaces keep building. Deck-style surfaces (sparkline tiles, packed KPI grids,
 * data rows) opt into these tighter steps for gutters/padding where the base grid
 * feels too airy. Same 4px-derived grid, one notch denser. Direction-agnostic —
 * apply with logical properties (see file header).
 */
export const spacingCompact = {
  "0": 0,
  px: 1,
  "0.5": 2,
  "1": 3,
  "1.5": 5,
  "2": 6,
  "3": 10,
  "4": 12,
  "5": 16,
  "6": 20,
  "8": 28,
  "10": 36,
  "12": 44,
  "16": 56,
  "20": 72,
  "24": 88,
} as const;

export const radii = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  "2xl": 24,
  pill: 999,
} as const;

export const borderWidth = {
  none: 0,
  hairline: 1,
  thick: 2,
  heavy: 4,
} as const;

/** Common component sizing (control heights, icon sizes) on the same grid. */
export const sizing = {
  controlSm: 32,
  controlMd: 40,
  controlLg: 48,
  iconSm: 16,
  iconMd: 20,
  iconLg: 24,
  touchTarget: 44, // minimum accessible tap target (native)
} as const;

export type SpacingToken = keyof typeof spacing;
export type SpacingCompactToken = keyof typeof spacingCompact;
export type RadiusToken = keyof typeof radii;
