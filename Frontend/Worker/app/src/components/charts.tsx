/**
 * Lightweight, dependency-free chart primitives (DESIGN.md: tokens only, no hex).
 * A pure-View BarChart avoids pulling a native charting lib; bars scale to the
 * max value. Used by the Working Hours screen to visualize hours per bucket.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export interface BarDatum {
  label: string;
  value: number;
}

export function BarChart({ data, height = 140 }: { data: BarDatum[]; height?: number }) {
  const { theme } = useTheme();
  const max = Math.max(1, ...data.map((d) => d.value));
  const gap = Number(theme.tokens.spacing['2']);

  return (
    <View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          height,
          gap,
        }}
      >
        {data.map((d, i) => {
          const h = Math.max(2, Math.round((d.value / max) * (height - 20)));
          return (
            <View key={`${d.label}-${i}`} style={{ flex: 1, alignItems: 'center' }}>
              <Text
                style={{
                  color: theme.colors.textMuted,
                  fontSize: 10,
                  marginBottom: Number(theme.tokens.spacing['1']),
                }}
                numberOfLines={1}
              >
                {d.value}
              </Text>
              <View
                style={{
                  width: '100%',
                  height: h,
                  backgroundColor: theme.colors.accent,
                  borderTopStartRadius: Number(theme.tokens.radii.sm),
                  borderTopEndRadius: Number(theme.tokens.radii.sm),
                }}
              />
            </View>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', gap, marginTop: Number(theme.tokens.spacing['1']) }}>
        {data.map((d, i) => (
          <Text
            key={`lbl-${d.label}-${i}`}
            style={{ flex: 1, textAlign: 'center', color: theme.colors.textMuted, fontSize: 10 }}
            numberOfLines={1}
          >
            {d.label}
          </Text>
        ))}
      </View>
    </View>
  );
}
