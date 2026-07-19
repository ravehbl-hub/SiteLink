/**
 * Shared theme-aware UI primitives. Every color/space/radius comes from the
 * @sitelink/tokens Theme (DESIGN.md: never hard-code a hex/size). Directional
 * layout uses logical keys implicitly via RN's RTL handling; we avoid left/right.
 */
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import type { Theme as TokenTheme } from '@sitelink/tokens';
import { useTheme } from '../theme/ThemeProvider';

type Semantic = 'success' | 'warning' | 'danger' | 'info';

/**
 * Operations Deck teal glow for active/data surfaces, approximated on native as a
 * colored shadow (theme.glow.accent). Softer in light mode where the ground is
 * flat. Token-only — the color comes from the shared glow token.
 */
function accentGlow(theme: TokenTheme): ViewStyle {
  return {
    shadowColor: theme.glow.accent.color,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: theme.isDark ? 0.7 : 0.25,
    shadowRadius: Number(theme.tokens.spacing['2']),
    elevation: theme.isDark ? 4 : 0,
  };
}

/**
 * Neumorphic radius helper. When the active theme is the Cream/Teal neumorphic
 * one it exposes the softer radius scale (cards ~20, controls ~12, wells ~14);
 * otherwise fall back to the base radii so a Deck theme still renders. Token-only.
 */
function neuRadius(
  theme: TokenTheme,
  key: 'card' | 'control' | 'controlLg' | 'well',
  fallback: number,
): number {
  return Number(theme.neumorphic?.radii[key] ?? fallback);
}

/**
 * Neumorphic RAISED elevation for native. RN cannot render a dual/inset shadow,
 * so a raised element is the single dark drop-shadow from the theme elevation set
 * (md.native). Token-only — no hard-coded shadow values.
 */
function raised(theme: TokenTheme): ViewStyle {
  return theme.elevation.md.native as ViewStyle;
}

const raisedSm = (theme: TokenTheme): ViewStyle => theme.elevation.sm.native as ViewStyle;

/**
 * Neumorphic WELL (inset) for native. RN cannot inset-shadow, so per the spec a
 * well is approximated with a slightly darker `surfaceAlt` fill + a hairline
 * `border`. Token-only.
 */
function well(theme: TokenTheme): ViewStyle & TextStyle {
  return {
    backgroundColor: theme.colors.surfaceAlt,
    borderColor: theme.colors.border,
    borderWidth: Number(theme.tokens.borderWidth.hairline ?? 1),
  };
}

/** Tabular figures so numeric columns/amounts align (Operations Deck data feel). */
const TABULAR: Pick<TextStyle, 'fontVariant'> = { fontVariant: ['tabular-nums'] };

export function Screen({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.bg }}
      contentContainerStyle={{ padding: Number(theme.tokens.spacing['4']) }}
    >
      {children}
    </ScrollView>
  );
}

export function ScreenPlain({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  return <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>{children}</View>;
}

/**
 * Neumorphic panel. A soft, raised cream surface (theme.colors.surface) floating
 * on the cream ground via a single dark drop-shadow (the native neumorphic RAISED
 * approximation — RN has no dual/inset shadow). Softer card radius (~20). `glow`
 * opts a panel into the teal accent glow for active/data-forward cards; a glowing
 * card keeps a teal hairline ring to read as "live".
 */
export function Card({
  children,
  style,
  glow,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  glow?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: theme.colors.surface,
          borderRadius: neuRadius(theme, 'card', Number(theme.tokens.radii.md)),
          padding: Number(theme.tokens.spacingCompact['4']),
          marginBottom: Number(theme.tokens.spacingCompact['3']),
          ...(glow
            ? {
                borderColor: theme.glow.accent.color,
                borderWidth: Number(theme.tokens.borderWidth.hairline ?? 1),
                ...accentGlow(theme),
              }
            : raised(theme)),
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Title({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <Text
      style={{
        color: theme.colors.textPrimary,
        fontSize: Number(theme.tokens.fontSize.xl ?? 22),
        fontWeight: '700',
        marginBottom: Number(theme.tokens.spacing['3']),
        // Follow the writing direction: start-aligned (right in he, left in en/tr).
        textAlign: 'auto',
      }}
    >
      {children}
    </Text>
  );
}

export function SectionHeading({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <Text
      style={{
        color: theme.colors.textSecondary,
        fontSize: Number(theme.tokens.fontSize.sm ?? 14),
        fontWeight: '600',
        marginBottom: Number(theme.tokens.spacing['2']),
        textAlign: 'auto',
      }}
    >
      {children}
    </Text>
  );
}

export function Body({
  children,
  muted,
  numeric,
}: {
  children: React.ReactNode;
  muted?: boolean;
  /** Render with tabular figures so numbers/amounts align across rows. */
  numeric?: boolean;
}) {
  const { theme } = useTheme();
  const style: TextStyle = {
    color: muted ? theme.colors.textMuted : theme.colors.textPrimary,
    // Follow the writing direction so labels/values sit on the start edge of
    // their flex slot (right in he, left in en/tr).
    textAlign: 'auto',
    ...(numeric ? TABULAR : null),
  };
  return <Text style={style}>{children}</Text>;
}

export function Field({
  label,
  ...props
}: TextInputProps & { label: string }) {
  const { theme } = useTheme();
  return (
    <View style={{ marginBottom: Number(theme.tokens.spacing['3']) }}>
      <Text
        style={{
          color: theme.colors.textSecondary,
          marginBottom: Number(theme.tokens.spacing['1']),
          fontSize: Number(theme.tokens.fontSize.sm ?? 14),
          textAlign: 'auto',
        }}
      >
        {label}
      </Text>
      <TextInput
        placeholderTextColor={theme.colors.textMuted}
        {...props}
        style={{
          // Neumorphic WELL: sunken feel via a darker surfaceAlt fill + hairline
          // border (RN can't inset-shadow). Rounded to the well radius (~14).
          ...well(theme),
          borderRadius: neuRadius(theme, 'well', Number(theme.tokens.radii.sm)),
          // Compact density to match the language Segmented control height.
          paddingVertical: Number(theme.tokens.spacingCompact['2']),
          paddingHorizontal: Number(theme.tokens.spacing['3']),
          color: theme.colors.textPrimary,
          textAlign: 'auto',
        }}
      />
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
}) {
  const { theme } = useTheme();
  const bg =
    variant === 'primary'
      ? theme.colors.accent
      : variant === 'danger'
        ? theme.colors.danger
        : theme.colors.surfaceAlt;
  const fg = variant === 'secondary' ? theme.colors.textPrimary : theme.colors.onAccent;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      // Compact VISUAL chrome (~controlSm) but keep a ~44px accessible tap area:
      // the vertical hitSlop expands the touch region above/below the short button.
      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
      style={({ pressed }) => ({
        backgroundColor: bg,
        opacity: disabled ? 0.5 : 1,
        // Softer neumorphic control radius (~12).
        borderRadius: neuRadius(theme, 'control', Number(theme.tokens.radii.sm)),
        // Compact density to match the language Segmented control height.
        paddingVertical: Number(theme.tokens.spacingCompact['2']),
        paddingHorizontal: Number(theme.tokens.spacing['4']),
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: Number(theme.tokens.spacing['2']),
        // Neumorphic: RAISED at rest, FLATTER when pressed (drop the shadow so the
        // control reads as sunk into the ground). Disabled reads flat too.
        ...(pressed || disabled ? null : raised(theme)),
      })}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={{ color: fg, fontWeight: '600' }}>{title}</Text>
      )}
    </Pressable>
  );
}

/** A semantic status pill (DESIGN.md status color mapping). */
export function StatusPill({ label, tone }: { label: string; tone: Semantic }) {
  const { theme } = useTheme();
  const bgMap: Record<Semantic, string> = {
    success: theme.colors.successSubtle,
    warning: theme.colors.warningSubtle,
    danger: theme.colors.dangerSubtle,
    info: theme.colors.infoSubtle,
  };
  const fgMap: Record<Semantic, string> = {
    success: theme.colors.success,
    warning: theme.colors.warning,
    danger: theme.colors.danger,
    info: theme.colors.info,
  };
  return (
    <View
      style={{
        backgroundColor: bgMap[tone],
        // Encode state in FORM as well as color: a tone-matched hairline ring.
        borderColor: fgMap[tone],
        borderWidth: Number(theme.tokens.borderWidth.hairline ?? 1),
        borderRadius: Number(theme.neumorphic?.radii.pill ?? theme.tokens.radii.pill ?? 999),
        paddingVertical: Number(theme.tokens.spacingCompact['1']),
        paddingHorizontal: Number(theme.tokens.spacingCompact['3']),
        alignSelf: 'flex-start',
      }}
    >
      <Text style={{ color: fgMap[tone], fontSize: 12, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

/** Labeled metric for dashboard cards. Deck: teal value + tabular figures. */
export function Metric({ label, value }: { label: string; value: string | number }) {
  const { theme } = useTheme();
  return (
    <View style={{ flexBasis: '48%', marginBottom: Number(theme.tokens.spacingCompact['3']) }}>
      <Text
        style={{
          color: theme.colors.accent,
          fontSize: Number(theme.tokens.fontSize.xl ?? 22),
          fontWeight: '700',
          textAlign: 'auto',
          ...TABULAR,
        }}
      >
        {value}
      </Text>
      <Text style={{ color: theme.colors.textMuted, fontSize: 12, textAlign: 'auto' }}>
        {label}
      </Text>
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  const { theme } = useTheme();
  return (
    <View style={styles.center}>
      <ActivityIndicator color={theme.colors.accent} />
      {label ? <Body muted>{label}</Body> : null}
    </View>
  );
}

export function EmptyState({ label }: { label: string }) {
  return (
    <View style={styles.center}>
      <Body muted>{label}</Body>
    </View>
  );
}

export function ErrorState({ label, onRetry }: { label: string; onRetry?: () => void }) {
  const { theme } = useTheme();
  return (
    <View style={styles.center}>
      <Text style={{ color: theme.colors.danger, marginBottom: 8, textAlign: 'auto' }}>{label}</Text>
      {onRetry ? <Button title="↻" variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

/** Simple segmented chooser used for enum selection + filters. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.row}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            accessibilityRole="button"
            // Compact select trigger, but preserve a ~44px accessible tap area.
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            style={{
              backgroundColor: active ? theme.colors.accent : theme.colors.surfaceAlt,
              // Softer neumorphic control radius (~12).
              borderRadius: neuRadius(theme, 'control', Number(theme.tokens.radii.sm)),
              paddingVertical: Number(theme.tokens.spacingCompact['2']),
              paddingHorizontal: Number(theme.tokens.spacingCompact['3']),
              marginEnd: Number(theme.tokens.spacingCompact['2']),
              marginBottom: Number(theme.tokens.spacingCompact['2']),
              // Active reads as a live element (teal glow); inactive chips sit as a
              // soft RAISED neumorphic control (subtle drop-shadow).
              ...(active ? accentGlow(theme) : raisedSm(theme)),
            }}
          >
            <Text style={{ color: active ? theme.colors.onAccent : theme.colors.textSecondary }}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Row({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 32, gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
});

export type { TokenTheme };
