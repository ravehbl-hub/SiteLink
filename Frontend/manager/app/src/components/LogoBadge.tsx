/**
 * LogoBadge — the SiteLink logo (crane + teal wordmark) presented on a white,
 * rounded "chip". The source PNG has an OPAQUE WHITE background, so on the dark
 * Operations-Deck theme a bare logo would read as a raw white rectangle. The
 * chip makes that white intentional: a white ground, subtle padding, rounded
 * corners and a hairline border so it stays defined in light mode too.
 *
 * NOTE: never apply `tintColor` to this logo — the artwork is full-colour, and
 * tinting recolours every opaque pixel into one flat block (the "green square"
 * bug). This component intentionally renders the logo untinted.
 *
 * `variant`:
 *   - "header": compact, for the drawer header END (right in LTR / left in he).
 *   - "login":  larger, for the auth screen above the title.
 */
import React from 'react';
import { Image, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const LOGO = require('../../assets/logo.png');

type Variant = 'header' | 'login';

const SIZES: Record<Variant, { width: number; height: number; padding: number; radius: number }> = {
  header: { width: 112, height: 40, padding: 6, radius: 8 },
  login: { width: 220, height: 84, padding: 10, radius: 12 },
};

export function LogoBadge({ variant = 'header' }: { variant?: Variant }) {
  const { theme } = useTheme();
  const s = SIZES[variant];
  return (
    <View
      style={{
        backgroundColor: '#FFFFFF',
        paddingHorizontal: s.padding,
        paddingVertical: s.padding,
        borderRadius: s.radius,
        borderWidth: 1,
        borderColor: theme.colors.border,
        alignItems: 'center',
        justifyContent: 'center',
        // Keep the chip off the header END edge; logical prop preserves RTL.
        marginEnd: variant === 'header' ? Number(theme.tokens.spacing['3']) : 0,
      }}
    >
      <Image
        source={LOGO}
        resizeMode="contain"
        style={{ width: s.width, height: s.height }}
        accessibilityLabel="SiteLink"
      />
    </View>
  );
}
