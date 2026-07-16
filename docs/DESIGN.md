# SiteLink Design System

Single source of truth: **`@sitelink/tokens`** (`packages/ui-tokens`). Both front
ends import it — the Manager **web** app (React/Vite) and the Manager **app**
(React Native/Expo). Never hard-code a hex, size or shadow in a screen; always
read a token. This keeps light/dark, i18n/RTL and semantic status colors
consistent across platforms.

## Brand — Direction 03 "Operations Deck"

Derived from the SiteLink logo — a single-teal wordmark with a crane and
construction workers. Industrial, professional, restrained. Teal is the identity;
neutrals are teal-biased slate (not pure grey); status colors are deliberately
outside the teal family so they read as meaning, not decoration.

**The product now leads with DARK.** Direction 03 "Operations Deck" makes dark a
command-center: dense, calm and status-forward, like a control room screen.

- **Dark-first.** Dark is the PRIMARY theme (`defaultThemeName = "dark"`,
  `defaultTheme`). Light still ships and works; the product just defaults to dark.
- **Deep teal-black ground.** The background reads as a radial
  "command-center" gradient — `#12343B` center → `#0A1618` edges
  (`--sl-bg-gradient`, `bgGradientFrom`/`bgGradientTo`). Panels are
  `#0e1e22` / `#12262b` with teal hairline borders `#21454c`, 9–12px radius.
- **Teal is the single accent, used only for data/active state.** Charts,
  sparklines, active tiles, selected KPI cards, focus. Give it a glow rather than
  a flat fill (`--sl-glow-accent` / `theme.glow.accent`). Teal never encodes a
  status.
- **Status lives OUTSIDE teal and is encoded in FORM.** success/"live" green
  `#3ED8A0`, amber warning, red critical — carried as pills, dots and stripes
  (shape + color), never color alone. A "live" glow (`--sl-glow-live`) marks
  online/healthy indicators.
- **Text.** primary `#EAF2F2`, secondary `#7F9BA0`, muted `#8FA6A9`. Use
  `tabular-nums` (`font-variant-numeric`) for aligned digits in tables/KPIs.
- **Density.** Dense + calm. Deck surfaces opt into the compact spacing scale
  (`spacingCompact` / `--sl-space-compact-*`) for packed grids, tiles and data
  rows; the base `spacing` scale is unchanged for everything else.

## Palette (named hex)

### Brand teal ramp
| Token | Hex | Note |
|---|---|---|
| teal.50 | `#E9F3F4` | tint / light accent-subtle |
| teal.100 | `#CBE3E5` | |
| teal.200 | `#A3CDD1` | dark accent-hover |
| teal.300 | `#5AA0A6` | secondary teal (brief) / dark accent |
| teal.400 | `#3A8B92` | light focus ring |
| teal.500 | `#1F7A82` | **core brand teal** (brief) / light accent |
| teal.600 | `#1A6A71` | light accent-hover |
| teal.700 | `#155860` | |
| teal.800 | `#12343B` | **deep teal-black ink** (brief) / light text-primary |
| teal.900 | `#0C2429` | dark on-accent |

### Neutrals (teal-biased slate)
`50 #F4F7F7` · `100 #E7EDED` · `200 #D0DADB` · `300 #AEBDBE` · `400 #83979A` ·
`500 #5E7275` · `600 #465759` · `700 #334143` · `800 #212C2E` · `900 #141B1D`

### Semantic bases
| Role | Light base (muted) | Dark base |
|---|---|---|
| success (green) | `#2F6B48` | `#3ED8A0` (brighter "live" green) |
| warning (amber) | `#8A5E1E` | `#EAAE43` |
| danger (red) | `#9A3838` | `#E37373` |
| info (blue) | `#345E88` | `#639FDB` |

The **light** semantic bases are the *desaturated* Deck values (see the light
variant note below); the raw ramp `*[600]` entries they were derived from
(`green #177544`, `amber #A06408`, `red #A12626`, `blue #1D5493`) remain in the
ramps for reference/data-viz. Each role has a `*Subtle` background variant
(light: tint `50`; dark: dark tint) for chips, table rows and banners. Full ramps
are exported as `ramps` for data-viz.

### Resolved theme roles
`bg, surface, surfaceAlt, border, textPrimary, textSecondary, textMuted, accent,
accentHover, onAccent, accentSubtle, success/warning/danger/info (+ *Subtle),
focusRing, bgGradientFrom, bgGradientTo`. See `lightColors` / `darkColors` in
`src/color.ts` (bundled into the `lightTheme` / `darkTheme` `Theme` objects in
`src/theme.ts`).

**Dark (Operations Deck) resolved values:**

| Role | Dark value |
|---|---|
| bg | `#0A1618` |
| surface | `#0e1e22` |
| surfaceAlt | `#12262b` |
| border | `#21454c` |
| textPrimary | `#EAF2F2` |
| textSecondary | `#7F9BA0` |
| textMuted | `#8FA6A9` |
| accent | `#5AA0A6` |
| accentHover | `#3A8B92` |
| onAccent | `#0C2429` |
| accentSubtle | `#12262b` |
| success | `#3ED8A0` |
| warning | `#EAAE43` |
| danger | `#E37373` |
| info | `#639FDB` |
| focusRing | `#5AA0A6` |
| bgGradientFrom | `#12343B` |
| bgGradientTo | `#0A1618` |

**Light (Operations Deck) variant — calmer & flatter.**

Dark leads the Deck and keeps its vivid, glowing accent/data colors. The LIGHT
variant is deliberately restrained so the light dashboard reads professional
rather than hot/heavy on the near-white ground (`bg #F4F7F7`, white surfaces).
Two dials were pulled DOWN for light only — dark is frozen/untouched:

- **Flatter elevation.** `lightElevation` (`src/elevation.ts`) is a separate set
  from `darkElevation`, so light shadows were softened without touching dark.
  Cards already carry a hairline `--sl-color-border`, which now does the
  separation work; shadow is only a whisper. Web `box-shadow` before → after:
  - `sm`: `0 1px 2px/.08 + 0 1px 3px/.06` → `0 1px 1px rgba(18,52,59,.04)`
  - `md`: `0 2px 6px/.10 + 0 4px 12px/.08` → `0 1px 2px/.05 + 0 2px 6px/.04`
  - `lg`: `0 8px 24px/.14 + 0 2px 6px/.10` → `0 4px 12px/.08 + 0 1px 3px/.05`
- **Muted colors.** The light accent + semantics were desaturated toward the
  teal-biased slate (lower chroma, same lightness, so AA contrast on white is
  preserved). These are the exact tokens the manager-web dashboard SVG charts
  read (`--sl-color-accent` for site/salary bars, `--sl-color-success/info/
  warning/danger` for the finance bars + workforce donut), so charts calm down
  in light mode automatically. Before → after:
  - accent `#1F7A82` → `#2C6B71`; accentHover `#1A6A71` → `#245A5F`
  - success `#177544` → `#2F6B48`; warning `#A06408` → `#8A5E1E`
  - danger `#A12626` → `#9A3838`; info `#1D5493` → `#345E88`

Light `bg`/surfaces and the (already near-flat) light gradient are unchanged —
`bgGradientFrom == bgGradientTo == #F4F7F7`, so the light ground stays calm/flat.

### Operations Deck tokens (glow / gradient / density)

Additive — no existing key was renamed or removed.

**Glow** (`glow` in `src/color.ts`; on the theme as `theme.glow`; CSS vars). Teal
accent glow is for data/active state; live glow marks online/healthy status.

| Token | CSS var | Value |
|---|---|---|
| glow.accent.web | `--sl-glow-accent` | `0 0 0 1px #2f5b5c, 0 8px 24px -8px rgba(58,139,146,.5)` |
| glow.accent.color | `--sl-glow-accent-color` | `#3A8B92` |
| glow.live.web | `--sl-glow-live` | `0 0 0 1px #1c5a45, 0 6px 20px -8px rgba(62,216,160,.45)` |
| glow.live.color | `--sl-glow-live-color` | `#3ED8A0` |

**Gradient** (per-theme; the radial command-center ground).

| Token | CSS var |
|---|---|
| colors.bgGradientFrom | `--sl-color-bg-gradient-from` |
| colors.bgGradientTo | `--sl-color-bg-gradient-to` |
| (ready-to-use) | `--sl-bg-gradient` = `radial-gradient(120% 120% at 50% 0%, from 0%, to 60%)` |

**Density** — `spacingCompact` (`tokens.spacingCompact`, `--sl-space-compact-*`).
An ADDITIVE, one-notch-denser scale on the same 4px grid; the base `spacing`
scale is untouched so no layout breaks. Deck surfaces opt in for gutters/padding
in packed grids, tiles and data rows. Steps: `1`=3, `2`=6, `3`=10, `4`=12, `5`=16,
`6`=20, `8`=28, `10`=36, `12`=44 (px).

## Typography

- **display** — industrial/grotesque for headings, KPIs, uppercase labels.
  Intended self-hosted face **Archivo**.
- **body** — clean grotesque for UI and content. Intended self-hosted face **Inter**.
- **mono** — IDs, coordinates, timesheets.

Stacks lead with system-safe faces (Segoe UI, San Francisco, Roboto, Noto incl.
**Noto Sans Hebrew**) so Hebrew and Turkish render even before the named face
loads. **No CDN dependency** — self-host Archivo/Inter or accept the system
fallback. Scale, weights and named `textStyles` (h1…caption, label) live in
`src/typography.ts`. Uppercase eyebrow labels use `letterSpacing.label` (0.08em).

## Using tokens

### Web (React/Vite) — Maestro
Two complementary paths:
1. **CSS variables** — import once at the app root:
   ```ts
   import "@sitelink/tokens/css/tokens.css";
   ```
   Then use `var(--sl-color-accent)`, `var(--sl-space-4)`, `var(--sl-radius-md)`,
   `var(--sl-elevation-md)`, etc. in CSS/CSS-modules.
2. **TS object** — `import { lightTheme, tokens } from "@sitelink/tokens"` for
   logic, charts, or CSS-in-JS.

The generated `packages/ui-tokens/css/tokens.css` is committed and ready to use.

### Native (React Native/Expo) — Moby
RN has no CSS. Import the theme object and feed it through a provider:
```ts
import { lightTheme, darkTheme } from "@sitelink/tokens";
```
Use `theme.colors.accent`, `theme.tokens.spacing["4"]`,
`theme.elevation.md.native` (spread the RN shadow props). Use
`fontFamilyNative` names (single family, OS fallback) — not the CSS stacks.

## Theming approach

- **Shared:** `lightTheme` / `darkTheme` (`Theme` type) bundle `colors` +
  `elevation` + `glow` + mode-agnostic `tokens`. `isDark` flag for status bars /
  imagery. **`defaultTheme` / `defaultThemeName` = dark** — the primary theme;
  seed initial state from these (an explicit user/system choice still overrides).
- **Web:** **DARK is the default on `:root`** (Operations Deck). Light opts in
  under `[data-theme="light"]`; `[data-theme="dark"]` restates the default so an
  explicit dark attribute resolves identically. Set `data-theme` on `<html>` to
  pin a theme; all `var(--sl-*)` update instantly. Respect `prefers-color-scheme`
  for the initial value and persist the user choice.
- **Native:** a `ThemeProvider` + `useTheme()` context holding `light`/`dark`,
  seeded from `defaultTheme` (dark) / `Appearance.getColorScheme()`, override +
  persist. Read the teal-glow via `theme.glow.accent.color` and the compact scale
  via `theme.tokens.spacingCompact`.

## RTL guidance (FR-X-I18N)

Locales: English + Turkish (LTR), Hebrew (RTL). Spacing tokens are
**direction-agnostic** — they express size, never a side. Apply them logically:
- **Web:** logical CSS only — `margin-inline-start`, `padding-inline-end`,
  `inset-inline-*`, `border-start-start-radius`, `text-align: start`. Set
  `dir="rtl"` on `<html>` for Hebrew; never use `left`/`right`.
- **Native:** rely on RN's `I18nManager` and logical style keys — `marginStart`,
  `paddingEnd`, `start`/`end` — never `left`/`right`. Mirror directional icons
  (chevrons, back arrows).
- Do **not** uppercase Hebrew labels or apply `letterSpacing.label` to Hebrew;
  reserve that treatment for Latin-locale eyebrow labels.

## Semantic-color usage mapping

Consistent status coloring across web and native. Use the `*Subtle` background
with the base color for text/border/icon.

| Domain | State | Token |
|---|---|---|
| Attendance | present / attended | `success` |
| Attendance | vacation / leave | `info` |
| Attendance | sick / disease | `warning` (planned) · `danger` (unreported/critical) |
| Attendance | absent (unexcused) | `danger` |
| Request | pending | `warning` |
| Request | approved | `success` |
| Request | rejected | `danger` |
| System health | healthy / online | `success` |
| System health | degraded | `warning` |
| System health | down / error | `danger` |
| General info / neutral notices | — | `info` |
| Primary actions, active nav, links, selection | — | `accent` (teal) |

Rule of thumb: **teal = brand/action**, never a status. Status is always
success/warning/danger/info so meaning is unambiguous and colorblind-distinct
(pair color with an icon/label, never color alone).
