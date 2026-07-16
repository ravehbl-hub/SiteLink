/**
 * Lightweight, dependency-free charts for the Foreman dashboard (FR-FOR-2).
 * Rendered with plain Views so the app needs no SVG/native chart dependency
 * (keeps the Expo bundle lean and New-Architecture safe). All colors come from
 * @sitelink/tokens via useTheme — never a hard-coded hex (DESIGN.md).
 */
import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Body, Row } from './ui';

export interface ChartDatum {
  label: string;
  value: number;
  /** A theme color string (already resolved from tokens by the caller). */
  color: string;
}

/**
 * A ring-style "donut": a horizontal stacked bar acting as the split visual plus
 * a legend. A true arc needs SVG; this reads clearly for an attendance split and
 * carries zero native dependencies.
 */
export function DonutChart({ data }: { data: ChartDatum[] }) {
  const { theme } = useTheme();
  const total = data.reduce((sum, d) => sum + Math.max(0, d.value), 0);

  return (
    <View>
      <View
        style={{
          flexDirection: 'row',
          height: 16,
          borderRadius: Number(theme.tokens.radii.pill ?? 999),
          overflow: 'hidden',
          backgroundColor: theme.colors.surfaceAlt,
          borderColor: theme.colors.border,
          borderWidth: Number(theme.tokens.borderWidth.hairline ?? 1),
          marginBottom: Number(theme.tokens.spacingCompact['3']),
        }}
      >
        {total > 0
          ? data.map((d, i) =>
              d.value > 0 ? (
                <View
                  key={i}
                  style={{ flex: d.value, backgroundColor: d.color }}
                  accessibilityLabel={`${d.label}: ${d.value}`}
                />
              ) : null,
            )
          : null}
      </View>
      {data.map((d, i) => (
        <Row key={i} style={{ justifyContent: 'space-between', paddingVertical: 2 }}>
          <Row>
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: d.color,
                marginEnd: Number(theme.tokens.spacing['2']),
              }}
            />
            <Body muted>{d.label}</Body>
          </Row>
          <Body numeric>
            {d.value}
            {total > 0 ? `  (${Math.round((d.value / total) * 100)}%)` : ''}
          </Body>
        </Row>
      ))}
    </View>
  );
}

/** A simple horizontal bar chart, one row per datum, scaled to the max value. */
export function BarChart({ data }: { data: ChartDatum[] }) {
  const { theme } = useTheme();
  const max = data.reduce((m, d) => Math.max(m, d.value), 0) || 1;

  return (
    <View>
      {data.map((d, i) => (
        <View key={i} style={{ marginBottom: Number(theme.tokens.spacingCompact['2']) }}>
          <Row style={{ justifyContent: 'space-between', marginBottom: 2 }}>
            <Body muted>{d.label}</Body>
            <Body numeric>{d.value}</Body>
          </Row>
          <View
            style={{
              height: 10,
              borderRadius: Number(theme.tokens.radii.sm),
              backgroundColor: theme.colors.surfaceAlt,
              borderColor: theme.colors.border,
              borderWidth: Number(theme.tokens.borderWidth.hairline ?? 1),
              overflow: 'hidden',
            }}
          >
            {/* Glowing data fill. In dark (Operations Deck) the bar carries a soft
                glow in its own hue; light mode stays flat/calm. Container clips the
                bar so the glow reads as an inner luminance, not an outer halo. */}
            <View
              style={{
                width: `${Math.max(2, (d.value / max) * 100)}%`,
                height: '100%',
                backgroundColor: d.color,
                ...(theme.isDark
                  ? {
                      shadowColor: d.color,
                      shadowOpacity: 0.9,
                      shadowRadius: 6,
                      shadowOffset: { width: 0, height: 0 },
                      elevation: 4,
                    }
                  : null),
              }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}
