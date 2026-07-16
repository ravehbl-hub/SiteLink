/**
 * SiteLink elevation tokens.
 *
 * Cross-platform shadows are awkward: web uses a `box-shadow` string, React
 * Native uses discrete shadow props (iOS: shadowColor/Offset/Opacity/Radius;
 * Android: elevation). Each level therefore ships BOTH representations so a
 * consumer picks the one its platform understands.
 *
 * Dark themes read shadows poorly, so the dark set is softer/deeper and leans on
 * borders (see color tokens) for separation.
 */

export interface ElevationToken {
  /** Web `box-shadow` value. */
  web: string;
  /** React Native shadow props (iOS + Android). */
  native: {
    shadowColor: string;
    shadowOffset: { width: number; height: number };
    shadowOpacity: number;
    shadowRadius: number;
    elevation: number;
  };
}

const rn = (
  color: string,
  y: number,
  opacity: number,
  radius: number,
  elevation: number,
): ElevationToken["native"] => ({
  shadowColor: color,
  shadowOffset: { width: 0, height: y },
  shadowOpacity: opacity,
  shadowRadius: radius,
  elevation,
});

export interface ElevationSet {
  none: ElevationToken;
  sm: ElevationToken;
  md: ElevationToken;
  lg: ElevationToken;
}

/**
 * LIGHT elevation — deliberately FLAT for the Operations Deck light variant.
 *
 * Cards already carry a hairline `--sl-color-border`, so light mode leans on that
 * border for separation and keeps only a whisper of shadow (much lower opacity,
 * smaller blur, no spread). This reads calmer/flatter/more professional than the
 * original heavier drop-shadows. (Dark stays deep — see `darkElevation`.)
 */
export const lightElevation: ElevationSet = {
  none: { web: "none", native: rn("#000000", 0, 0, 0, 0) },
  sm: {
    // was: 0 1px 2px/0.08 + 0 1px 3px/0.06 — flattened to a single hairline shadow.
    web: "0 1px 1px rgba(18, 52, 59, 0.04)",
    native: rn("#12343B", 1, 0.05, 2, 1),
  },
  md: {
    // was: 0 2px 6px/0.1 + 0 4px 12px/0.08 — flattened, border carries separation.
    web: "0 1px 2px rgba(18, 52, 59, 0.05), 0 2px 6px rgba(18, 52, 59, 0.04)",
    native: rn("#12343B", 2, 0.07, 6, 3),
  },
  lg: {
    // was: 0 8px 24px/0.14 + 0 2px 6px/0.1 — reserved for true overlays; still soft.
    web: "0 4px 12px rgba(18, 52, 59, 0.08), 0 1px 3px rgba(18, 52, 59, 0.05)",
    native: rn("#12343B", 4, 0.1, 14, 6),
  },
};

export const darkElevation: ElevationSet = {
  none: { web: "none", native: rn("#000000", 0, 0, 0, 0) },
  sm: {
    web: "0 1px 2px rgba(0, 0, 0, 0.4)",
    native: rn("#000000", 1, 0.4, 3, 2),
  },
  md: {
    web: "0 4px 12px rgba(0, 0, 0, 0.5)",
    native: rn("#000000", 4, 0.5, 12, 6),
  },
  lg: {
    web: "0 8px 24px rgba(0, 0, 0, 0.6)",
    native: rn("#000000", 8, 0.6, 24, 12),
  },
};

export type ElevationLevel = keyof ElevationSet;
