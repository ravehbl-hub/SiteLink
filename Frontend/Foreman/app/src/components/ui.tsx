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
  type ViewStyle,
} from 'react-native';
import type { Theme as TokenTheme } from '@sitelink/tokens';
import { useTheme } from '../theme/ThemeProvider';

type Semantic = 'success' | 'warning' | 'danger' | 'info';

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
 * Cream/teal NEUMORPHIC panel. A soft "extruded" card on the warm cream surface:
 * RAISED via a single dark drop-shadow (native limitation — RN has no dual/inset
 * shadow, so the dual dark+light of the web spec collapses to the drop shadow in
 * `theme.elevation.md.native`). The dual shadow provides separation, so no heavy
 * border — only a whisper-hairline in the neumorphic line color. Softer card
 * radius (`neumorphic.radii.card` ~20). When `glow` is set it becomes an
 * "active/data" tile: a teal accent border plus a soft teal shadow.
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
  const cardRadius = Number(theme.neumorphic?.radii.card ?? theme.tokens.radii.xl ?? 16);
  const glowStyle: ViewStyle = glow
    ? {
        borderColor: theme.colors.accent,
        shadowColor: theme.glow.accent.color,
        shadowOpacity: 0.3,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 6 },
        elevation: 6,
      }
    : {};
  return (
    <View
      style={[
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderWidth: Number(theme.tokens.borderWidth.hairline ?? 1),
          borderRadius: cardRadius,
          padding: Number(theme.tokens.spacingCompact['4']),
          marginBottom: Number(theme.tokens.spacingCompact['3']),
          // RAISED neumorphic drop-shadow (native approximation of the dual shadow).
          ...theme.elevation.md.native,
        },
        glowStyle,
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
        // 'auto' resolves to the writing direction: right in RTL (he), left in
        // LTR (en/tr). RN Text does NOT auto-flip without this.
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
  /** Align digits with tabular-nums for data columns (Operations Deck). */
  numeric?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Text
      style={{
        color: muted ? theme.colors.textMuted : theme.colors.textPrimary,
        // Follow writing direction (he → right, en/tr → left).
        textAlign: 'auto',
        ...(numeric ? { fontVariant: ['tabular-nums' as const] } : null),
      }}
    >
      {children}
    </Text>
  );
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
          // NEUMORPHIC "well": native can't render an inset shadow, so we read
          // pressed-in via a recessed `surfaceAlt` fill + a hairline line border
          // and a softer well radius (docs/NEUMORPHIC.md native limitation).
          borderColor: theme.colors.border,
          borderWidth: Number(theme.tokens.borderWidth.hairline ?? 1),
          borderRadius: Number(theme.neumorphic?.radii.well ?? theme.tokens.radii.md),
          paddingVertical: Number(theme.tokens.spacing['2']),
          paddingHorizontal: Number(theme.tokens.spacing['3']),
          color: theme.colors.textPrimary,
          backgroundColor: theme.colors.surfaceAlt,
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
        : theme.colors.surface;
  const fg = variant === 'secondary' ? theme.colors.textPrimary : theme.colors.onAccent;
  // Secondary (surface) buttons get a hairline so they read as a raised tile on
  // the cream ground; teal/danger fills stand on their own.
  const border = variant === 'secondary' ? theme.colors.border : bg;
  const controlRadius = Number(theme.neumorphic?.radii.control ?? theme.tokens.radii.sm);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      // Compact VISUAL chrome (matches the Segmented) but keep a ~44px accessible
      // tap area: the vertical hitSlop expands the touch region above/below.
      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
      style={({ pressed }) => ({
        backgroundColor: bg,
        borderColor: border,
        borderWidth: Number(theme.tokens.borderWidth.hairline ?? 1),
        opacity: disabled ? 0.5 : 1,
        borderRadius: controlRadius,
        // Match the language Segmented control height (less tall).
        paddingVertical: Number(theme.tokens.spacing['2']),
        paddingHorizontal: Number(theme.tokens.spacing['4']),
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: Number(theme.tokens.spacing['2']),
        // RAISED at rest; FLATTER when pressed (native approximation of the
        // neumorphic raised→inset state swap — no inset shadow on RN).
        ...(pressed || disabled ? theme.elevation.sm.native : theme.elevation.md.native),
      })}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={{ color: fg, fontWeight: '700' }}>{title}</Text>
      )}
    </Pressable>
  );
}

/**
 * A semantic status pill (DESIGN.md status color mapping). Operations Deck form:
 * a subtle-tinted fill PLUS a hairline border in the status hue and a small
 * leading status dot, so state is encoded in FORM as well as color (color-blind
 * safe). Compact padding.
 */
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
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: bgMap[tone],
        borderColor: fgMap[tone],
        borderWidth: Number(theme.tokens.borderWidth.hairline ?? 1),
        borderRadius: Number(theme.tokens.radii.pill ?? 999),
        paddingVertical: Number(theme.tokens.spacingCompact['1']),
        paddingHorizontal: Number(theme.tokens.spacingCompact['3']),
        alignSelf: 'flex-start',
      }}
    >
      <View
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: fgMap[tone],
          marginEnd: Number(theme.tokens.spacingCompact['2']),
        }}
      />
      <Text style={{ color: fgMap[tone], fontSize: 12, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

/**
 * Operations Deck KPI tile. A dense inset panel (teal-tinted `accentSubtle`
 * ground, teal hairline border, soft teal glow) with a big tabular-nums accent
 * value and a muted label — the "glow KPI tile" of the dashboard grid.
 */
export function Metric({ label, value }: { label: string; value: string | number }) {
  const { theme } = useTheme();
  return (
    <View
      style={{
        flexBasis: '48%',
        marginBottom: Number(theme.tokens.spacingCompact['2']),
        backgroundColor: theme.colors.accentSubtle,
        borderColor: theme.colors.border,
        borderWidth: Number(theme.tokens.borderWidth.hairline ?? 1),
        borderRadius: Number(theme.tokens.radii.md),
        paddingVertical: Number(theme.tokens.spacingCompact['3']),
        paddingHorizontal: Number(theme.tokens.spacingCompact['3']),
        shadowColor: theme.glow.accent.color,
        shadowOpacity: 0.2,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 3,
      }}
    >
      <Text
        style={{
          color: theme.colors.accent,
          fontSize: Number(theme.tokens.fontSize.xl ?? 22),
          fontWeight: '700',
          fontVariant: ['tabular-nums'],
          textAlign: 'auto',
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
              // Chip: resting = recessed well (surfaceAlt), selected = teal fill.
              backgroundColor: active ? theme.colors.accent : theme.colors.surfaceAlt,
              borderColor: active ? theme.colors.accent : theme.colors.border,
              borderWidth: Number(theme.tokens.borderWidth.hairline ?? 1),
              borderRadius: Number(theme.neumorphic?.radii.chip ?? theme.tokens.radii.pill ?? 999),
              paddingVertical: Number(theme.tokens.spacing['2']),
              paddingHorizontal: Number(theme.tokens.spacing['3']),
              marginEnd: Number(theme.tokens.spacing['2']),
              marginBottom: Number(theme.tokens.spacing['2']),
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

/**
 * Reusable 1–5 rating control (FR-FOR-5). A row of five star pills; the active
 * range up to `value` is filled with the accent color. Colors from tokens only.
 */
export function RatingRow({
  value,
  onChange,
  max = 5,
}: {
  value: number | null;
  onChange: (v: number) => void;
  max?: number;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.row}>
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => {
        const active = value != null && n <= value;
        return (
          <Pressable
            key={n}
            onPress={() => onChange(n)}
            accessibilityRole="button"
            accessibilityLabel={String(n)}
            style={{
              width: 44,
              height: 44,
              borderRadius: Number(theme.neumorphic?.radii.control ?? theme.tokens.radii.sm),
              alignItems: 'center',
              justifyContent: 'center',
              marginEnd: Number(theme.tokens.spacing['2']),
              backgroundColor: active ? theme.colors.accentSubtle : theme.colors.surfaceAlt,
              borderWidth: Number(theme.tokens.borderWidth.hairline ?? 1),
              borderColor: active ? theme.colors.accent : theme.colors.border,
            }}
          >
            <Text style={{ color: active ? theme.colors.accent : theme.colors.textMuted, fontSize: 20 }}>
              {active ? '★' : '☆'}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 32, gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
});

export type { TokenTheme };
