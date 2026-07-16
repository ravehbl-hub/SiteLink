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
import { I18nManager, Text, View } from 'react-native';
import Svg, { Circle, Line, Rect, Text as SvgText } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';
import { Body } from './ui';

/**
 * Operations Deck "glow" for data marks. react-native-svg has no cross-platform
 * blur filter, so we approximate the web dashboard's glowing fills with a soft
 * translucent halo drawn BEHIND the mark (a slightly larger, low-opacity copy in
 * the same color). Only in dark mode — light is the calm/flat variant. The 0.28
 * factor is an opacity, not a color, so this stays token-only (no hard-coded hex).
 */
const GLOW_OPACITY = 0.28;

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
  const n = Math.max(1, data.length);
  const slot = W / n;
  // Crowd the x-axis? When slots get narrow (many categories, e.g. 12 sites),
  // upright centered labels overlap — angle them and give more bottom room
  // (mirrors the manager WEB BarChart).
  const angled = slot < 46;
  const padTop = 18; // headroom so the top value label never clips the frame/bar
  const padBottom = angled ? 56 : 40; // more room when labels are rotated
  const plotH = H - padTop - padBottom;
  const barW = Math.min(48, slot * 0.6);
  const max = Math.max(1, ...data.map((d) => d.value));
  const baseY = padTop + plotH;
  // Truncate to the space available per slot (~5.5px/char); angled labels get more.
  const maxChars = Math.max(4, Math.floor((angled ? slot * 1.6 : slot) / 5.5));

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
            {theme.isDark && h > 0 ? (
              // Teal-glow halo behind the bar (Operations Deck) — a wider, softer
              // copy of the bar in its own color at low opacity.
              <Rect
                x={x - 3}
                y={y - 3}
                width={barW + 6}
                height={h + 3}
                rx={5}
                fill={d.color}
                opacity={GLOW_OPACITY}
              />
            ) : null}
            <Rect x={x} y={y} width={barW} height={h} rx={3} fill={d.color} />
            <SvgText
              x={cx}
              // Floor the value-label y so a max-height bar's label stays inside
              // the viewBox (prevents top clipping on tall bars).
              y={Math.max(y - 4, 10)}
              fontSize={10}
              fontWeight="600"
              textAnchor="middle"
              fill={theme.colors.textPrimary}
            >
              {formatValue(d.value)}
            </SvgText>
            {angled ? (
              // Rotate ~40° around the label anchor so long site names don't collide.
              <SvgText
                x={cx}
                y={baseY + 12}
                fontSize={9}
                textAnchor="end"
                fill={theme.colors.textSecondary}
                transform={`rotate(-40 ${cx} ${baseY + 12})`}
              >
                {truncate(d.label, maxChars)}
              </SvgText>
            ) : (
              <SvgText
                x={cx}
                y={baseY + 16}
                fontSize={9}
                textAnchor="middle"
                fill={theme.colors.textSecondary}
              >
                {truncate(d.label, maxChars)}
              </SvgText>
            )}
          </React.Fragment>
        );
      })}
    </Svg>
  );
}

/**
 * Horizontal bar chart — one ROW per datum. Full category name reads on its own
 * row (numberOfLines=1 + tail ellipsis, NO manual char truncation, NO rotation),
 * a track View holds a fill View whose width = value/max, and the value sits at
 * the row end. This is the right choice for many long/RTL names (construction
 * sites), mirroring the manager WEB `HBarChart` (.hbar-* CSS).
 *
 * RTL: the row is a flexDirection:'row', which React Native FLIPS to visually
 * right-to-left under I18nManager.isRTL — so the label lands start-aligned (right
 * in Hebrew) and, because the fill is start-anchored inside the track (the track
 * is a plain row container and the fill is its first/only child at flex-start),
 * the bar grows from the inline-start edge (right in he, left in en). A
 * percentage width alone does not carry a direction, so anchoring the fill at the
 * row's start via the flex flow is what makes it mirror correctly.
 */
export function HBarChart({
  data,
  formatValue,
}: {
  data: Datum[];
  formatValue: (v: number) => string;
}) {
  const { theme } = useTheme();
  const max = Math.max(1, ...data.map((d) => d.value));
  const gap2 = Number(theme.tokens.spacing['2']);
  const gap1 = Number(theme.tokens.spacing['1']);

  return (
    <View style={{ alignSelf: 'stretch', gap: gap1 }}>
      {data.map((d, i) => (
        <View
          key={`${d.label}-${i}`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: gap2 }}
        >
          {/* Full site name — start-aligned, single line, tail ellipsis only if
              genuinely too long. No fragment truncation, no rotation. */}
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={{
              width: 116,
              fontSize: 12,
              color: theme.colors.textSecondary,
              textAlign: 'left',
            }}
          >
            {d.label}
          </Text>
          {/* Track: a row container so the fill anchors at the inline-start and,
              under RTL, RN flips the row so it grows from the right. */}
          <View
            style={{
              flex: 1,
              height: 10,
              borderRadius: 999,
              backgroundColor: theme.colors.surfaceAlt,
              overflow: 'hidden',
              flexDirection: 'row',
            }}
          >
            <View
              style={{
                width: `${(d.value / max) * 100}%`,
                minWidth: 2,
                height: '100%',
                borderRadius: 999,
                backgroundColor: d.color,
              }}
            />
          </View>
          <Text
            style={{
              fontSize: 12,
              color: theme.colors.textPrimary,
              fontVariant: ['tabular-nums'],
              textAlign: 'right',
              minWidth: 24,
            }}
          >
            {formatValue(d.value)}
          </Text>
        </View>
      ))}
    </View>
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
        {theme.isDark
          ? arcs.map((a, i) => (
              // Teal-glow halo behind each arc (Operations Deck): a thicker, softer
              // stroke of the same slice color at low opacity.
              <Circle
                key={`glow-${i}`}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={a.color}
                strokeWidth={stroke + 8}
                strokeDasharray={`${a.dash} ${a.gap}`}
                opacity={GLOW_OPACITY}
                transform={`rotate(${-90 + a.rotate} ${cx} ${cy})`}
              />
            ))
          : null}
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
