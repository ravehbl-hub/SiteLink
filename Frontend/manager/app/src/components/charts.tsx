/**
 * Dependency-light native charts for the Dashboard GRAPHICS view, mirroring the
 * web's inline-SVG approach (Frontend/manager/web .../DashboardScreen.tsx) but
 * built with react-native-svg (Expo SDK 54 / Reanimated 4 / New Arch compatible).
 *
 * All colors come from the active @sitelink/tokens Theme via useTheme() so both
 * dark and light palettes are honoured (DESIGN.md: never hard-code a hex). RTL
 * (Hebrew) is handled natively: bar order is mirrored when I18nManager.isRTL, and
 * the donut legend flows with the row direction which RN already flips under RTL.
 */
import React from 'react';
import { I18nManager, View } from 'react-native';
import Svg, { Circle, Line, Rect, Text as SvgText } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';
import { Body } from './ui';

export interface Datum {
  label: string;
  value: number;
  color: string;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Vertical bar chart. Under RTL the bar order is reversed so the chart reads
 * right-to-left, matching the web behaviour and native reading direction.
 */
export function BarChart({
  data,
  formatValue,
}: {
  data: Datum[];
  formatValue: (v: number) => string;
}) {
  const { theme } = useTheme();
  const W = 320;
  const H = 190;
  const padTop = 14;
  const padBottom = 44; // room for category labels
  const plotH = H - padTop - padBottom;
  const n = Math.max(1, data.length);
  const slot = W / n;
  const barW = Math.min(48, slot * 0.6);
  const max = Math.max(1, ...data.map((d) => d.value));
  const baseY = padTop + plotH;

  const items = I18nManager.isRTL ? [...data].reverse() : data;

  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      <Line x1={0} y1={baseY} x2={W} y2={baseY} stroke={theme.colors.border} strokeWidth={1} />
      {items.map((d, i) => {
        const h = (d.value / max) * plotH;
        const cx = slot * i + slot / 2;
        const x = cx - barW / 2;
        const y = baseY - h;
        return (
          <React.Fragment key={`${d.label}-${i}`}>
            <Rect x={x} y={y} width={barW} height={h} rx={3} fill={d.color} />
            <SvgText
              x={cx}
              y={y - 4}
              fontSize={10}
              fontWeight="600"
              textAnchor="middle"
              fill={theme.colors.textPrimary}
            >
              {formatValue(d.value)}
            </SvgText>
            <SvgText
              x={cx}
              y={baseY + 16}
              fontSize={9}
              textAnchor="middle"
              fill={theme.colors.textSecondary}
            >
              {truncate(d.label, 12)}
            </SvgText>
          </React.Fragment>
        );
      })}
    </Svg>
  );
}

/**
 * Donut chart via strokeDasharray on Circle arcs, plus a legend. The ring is
 * direction-agnostic; the legend rows flow with the layout direction (RN flips
 * flexDirection under RTL), so labels/values align correctly in Hebrew.
 */
export function DonutChart({
  data,
  totalLabel,
  formatValue,
  emptyLabel,
}: {
  data: Datum[];
  totalLabel: string;
  formatValue: (v: number) => string;
  emptyLabel: string;
}) {
  const { theme } = useTheme();
  const total = data.reduce((s, d) => s + Math.max(0, d.value), 0);
  const size = 160;
  const stroke = 26;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;

  let offset = 0;
  const arcs = total
    ? data.map((d) => {
        const frac = Math.max(0, d.value) / total;
        const dash = frac * circ;
        const arc = { color: d.color, dash, gap: circ - dash, rotate: (offset / circ) * 360 };
        offset += dash;
        return arc;
      })
    : [];

  return (
    <View style={{ alignItems: 'center', gap: Number(theme.tokens.spacing['3']) }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={theme.colors.surfaceAlt}
          strokeWidth={stroke}
        />
        {arcs.map((a, i) => (
          <Circle
            key={i}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={a.color}
            strokeWidth={stroke}
            strokeDasharray={`${a.dash} ${a.gap}`}
            // start at 12 o'clock, then rotate by this slice's cumulative offset
            transform={`rotate(${-90 + a.rotate} ${cx} ${cy})`}
          />
        ))}
        <SvgText
          x={cx}
          y={cy - 2}
          fontSize={16}
          fontWeight="700"
          textAnchor="middle"
          fill={theme.colors.textPrimary}
        >
          {formatValue(total)}
        </SvgText>
        <SvgText x={cx} y={cy + 16} fontSize={10} textAnchor="middle" fill={theme.colors.textSecondary}>
          {totalLabel}
        </SvgText>
      </Svg>

      <View style={{ alignSelf: 'stretch', gap: Number(theme.tokens.spacing['1']) }}>
        {total > 0 ? (
          data.map((d, i) => (
            <View
              key={`${d.label}-${i}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: Number(theme.tokens.spacing['2']) }}
            >
              <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: d.color }} />
              <View style={{ flex: 1 }}>
                <Body>{d.label}</Body>
              </View>
              <Body muted>{formatValue(d.value)}</Body>
            </View>
          ))
        ) : (
          <Body muted>{emptyLabel}</Body>
        )}
      </View>
    </View>
  );
}
