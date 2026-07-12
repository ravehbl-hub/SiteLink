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

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const { theme } = useTheme();
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
}: {
  children: React.ReactNode;
  muted?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Text style={{ color: muted ? theme.colors.textMuted : theme.colors.textPrimary }}>
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
      style={{
        backgroundColor: bg,
        opacity: disabled ? 0.5 : 1,
        borderRadius: Number(theme.tokens.radii.sm),
        paddingVertical: Number(theme.tokens.spacing['3']),
        paddingHorizontal: Number(theme.tokens.spacing['4']),
        alignItems: 'center',
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

/** Labeled metric for dashboard cards. */
export function Metric({ label, value }: { label: string; value: string | number }) {
  const { theme } = useTheme();
  return (
    <View style={{ flexBasis: '48%', marginBottom: Number(theme.tokens.spacing['3']) }}>
      <Text
        style={{
          color: theme.colors.accent,
          fontSize: Number(theme.tokens.fontSize.xl ?? 22),
          fontWeight: '700',
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

export function Row({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 32, gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
});

export type { TokenTheme };
