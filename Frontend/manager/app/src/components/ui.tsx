/**
 * Shared theme-aware UI primitives. Every color/space/radius comes from the
 * @sitelink/tokens Theme (DESIGN.md: never hard-code a hex/size). Directional
 * layout uses logical keys implicitly via RN's RTL handling; we avoid left/right.
 */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
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
 * Operations Deck panel. `glow` lifts the card to the active/data treatment: a
 * teal accent border + teal-tinted shadow (theme.glow.accent), matching the
 * Requests inbox PENDING cards and the web dashboard KPI tiles. Token-only.
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
  const glowStyle: ViewStyle = glow
    ? {
        borderColor: theme.glow.accent.color,
        borderWidth: Number(theme.tokens.borderWidth.hairline ?? 1),
        shadowColor: theme.glow.accent.color,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: theme.isDark ? 0.55 : 0.25,
        shadowRadius: Number(theme.tokens.spacing['3']),
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
          borderRadius: Number(theme.tokens.radii.md),
          padding: Number(theme.tokens.spacing['4']),
          marginBottom: Number(theme.tokens.spacing['3']),
          ...theme.elevation.sm.native,
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
      }}
    >
      {children}
    </Text>
  );
}

export function Body({
  children,
  muted,
  tabular,
}: {
  children: React.ReactNode;
  muted?: boolean;
  /** Aligned figures (tabular-nums) for money/counts on Operations Deck rows. */
  tabular?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Text
      style={{
        color: muted ? theme.colors.textMuted : theme.colors.textPrimary,
        ...(tabular ? { fontVariant: ['tabular-nums' as const] } : null),
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
        }}
      >
        {label}
      </Text>
      <TextInput
        placeholderTextColor={theme.colors.textMuted}
        {...props}
        style={{
          borderColor: theme.colors.border,
          borderWidth: 1,
          borderRadius: Number(theme.tokens.radii.sm),
          paddingVertical: Number(theme.tokens.spacing['2']),
          paddingHorizontal: Number(theme.tokens.spacing['3']),
          color: theme.colors.textPrimary,
          backgroundColor: theme.colors.surface,
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
      // Compact VISUAL chrome (matches the Segmented) but keep a ~44px accessible
      // tap area: the vertical hitSlop expands the touch region above/below.
      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
      style={{
        backgroundColor: bg,
        opacity: disabled ? 0.5 : 1,
        borderRadius: Number(theme.tokens.radii.sm),
        // Match the language Segmented control height (less tall).
        paddingVertical: Number(theme.tokens.spacing['2']),
        paddingHorizontal: Number(theme.tokens.spacing['4']),
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: Number(theme.tokens.spacing['2']),
      }}
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
        borderRadius: Number(theme.tokens.radii.pill ?? 999),
        paddingVertical: Number(theme.tokens.spacing['1']),
        paddingHorizontal: Number(theme.tokens.spacing['3']),
        alignSelf: 'flex-start',
      }}
    >
      <Text style={{ color: fgMap[tone], fontSize: 12, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

/**
 * Labeled KPI tile for dashboard cards. Operations Deck: the value uses
 * tabular-nums (aligned figures) and, when `glow`, the tile becomes a bordered
 * teal-glow panel on the inset surface (mirrors the web dashboard KPI tiles).
 * Token-only — the glow color is theme.glow.accent.
 */
export function Metric({
  label,
  value,
  glow,
}: {
  label: string;
  value: string | number;
  glow?: boolean;
}) {
  const { theme } = useTheme();
  const glowStyle: ViewStyle = glow
    ? {
        backgroundColor: theme.colors.surfaceAlt,
        borderColor: theme.glow.accent.color,
        borderWidth: Number(theme.tokens.borderWidth.hairline ?? 1),
        borderRadius: Number(theme.tokens.radii.md),
        paddingVertical: Number(theme.tokens.spacing['2']),
        paddingHorizontal: Number(theme.tokens.spacing['3']),
        shadowColor: theme.glow.accent.color,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: theme.isDark ? 0.5 : 0.22,
        shadowRadius: Number(theme.tokens.spacing['2']),
        elevation: 4,
      }
    : {};
  return (
    <View style={[{ flexBasis: '48%', marginBottom: Number(theme.tokens.spacing['3']) }, glowStyle]}>
      <Text
        style={{
          color: theme.colors.accent,
          fontSize: Number(theme.tokens.fontSize.xl ?? 22),
          fontWeight: '700',
          fontVariant: ['tabular-nums'],
        }}
      >
        {value}
      </Text>
      <Text style={{ color: theme.colors.textMuted, fontSize: 12 }}>{label}</Text>
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
      <Text style={{ color: theme.colors.danger, marginBottom: 8 }}>{label}</Text>
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
              borderRadius: Number(theme.tokens.radii.sm),
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

/**
 * Generic dropdown / combobox picker. A COMPACT trigger (matching the Segmented /
 * Button control height) that shows the current selection and, on tap, opens a
 * modal overlay list of options — each selectable, the active one marked with a
 * check. Modeled on the Foreman SitePicker (pill trigger + modal list) but made
 * reusable as Select<T> so any single-choice filter can adopt it.
 *
 * Deck theme tokens only (surface/border/text — no hex). RTL-correct: the trigger
 * lays out logically (chevron uses marginStart, text aligns to start), and each
 * option row keeps the label at the start with the check at the end. Long labels
 * (e.g. long seeded site names) stay readable — the option label wraps up to two
 * lines rather than truncating so the full name is visible in the list.
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  placeholder,
}: {
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  placeholder?: string;
}) {
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value) ?? null;
  const triggerLabel = selected?.label ?? placeholder ?? '';

  return (
    <View style={{ marginBottom: Number(theme.tokens.spacing['2']) }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={triggerLabel}
        onPress={() => setOpen(true)}
        // Compact trigger (matches the Segmented / Button height) with a ~44px
        // accessible tap area via vertical hitSlop.
        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          alignSelf: 'flex-start',
          backgroundColor: theme.colors.surfaceAlt,
          borderColor: theme.colors.border,
          borderWidth: Number(theme.tokens.borderWidth.hairline ?? 1),
          borderRadius: Number(theme.tokens.radii.sm),
          paddingVertical: Number(theme.tokens.spacing['2']),
          paddingHorizontal: Number(theme.tokens.spacing['3']),
        }}
      >
        <Text
          style={{
            color: selected ? theme.colors.textPrimary : theme.colors.textMuted,
            textAlign: 'auto',
          }}
          numberOfLines={1}
        >
          {triggerLabel}
        </Text>
        <Text
          style={{
            color: theme.colors.textSecondary,
            marginStart: Number(theme.tokens.spacing['2']),
          }}
        >
          ▾
        </Text>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            padding: Number(theme.tokens.spacing['4']),
          }}
        >
          {/* Dim scrim (tap to dismiss); color from a token, opacity for the veil. */}
          <Pressable
            onPress={() => setOpen(false)}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              right: 0,
              backgroundColor: theme.colors.textPrimary,
              opacity: 0.4,
            }}
          />
          <View
            style={{
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              borderWidth: Number(theme.tokens.borderWidth.hairline ?? 1),
              borderRadius: Number(theme.tokens.radii.md),
              padding: Number(theme.tokens.spacing['4']),
              ...theme.elevation.sm.native,
            }}
          >
            {placeholder ? (
              <Text
                style={{
                  color: theme.colors.textSecondary,
                  fontSize: Number(theme.tokens.fontSize.sm ?? 14),
                  fontWeight: '600',
                  marginBottom: Number(theme.tokens.spacing['2']),
                  textAlign: 'auto',
                }}
              >
                {placeholder}
              </Text>
            ) : null}
            <ScrollView style={{ maxHeight: 320 }}>
              {options.map((opt) => {
                const active = opt.value === value;
                return (
                  <Pressable
                    key={opt.value}
                    accessibilityRole="button"
                    onPress={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      backgroundColor: active ? theme.colors.accentSubtle : 'transparent',
                      borderRadius: Number(theme.tokens.radii.sm),
                      paddingVertical: Number(theme.tokens.spacing['3']),
                      paddingHorizontal: Number(theme.tokens.spacing['3']),
                      marginBottom: Number(theme.tokens.spacing['1']),
                    }}
                  >
                    <Text
                      style={{
                        flexShrink: 1,
                        color: active ? theme.colors.accent : theme.colors.textPrimary,
                        fontWeight: active ? '700' : '500',
                        textAlign: 'auto',
                      }}
                      numberOfLines={2}
                    >
                      {opt.label}
                    </Text>
                    {active ? (
                      <Text
                        style={{
                          color: theme.colors.accent,
                          fontWeight: '700',
                          marginStart: Number(theme.tokens.spacing['2']),
                        }}
                      >
                        ✓
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
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
