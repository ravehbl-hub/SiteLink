# SiteLink Design System

Single source of truth: **`@sitelink/tokens`** (`packages/ui-tokens`). Both front
ends import it — the Manager **web** app (React/Vite) and the Manager **app**
(React Native/Expo). Never hard-code a hex, size or shadow in a screen; always
read a token. This keeps light/dark, i18n/RTL and semantic status colors
consistent across platforms.

## Brand

Derived from the SiteLink logo — a single-teal wordmark with a crane and
construction workers. Industrial, professional, restrained. Teal is the identity;
neutrals are teal-biased slate (not pure grey); status colors are deliberately
outside the teal family so they read as meaning, not decoration.

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
| Role | Light base | Dark base |
|---|---|---|
| success (green) | `#177544` | `#5FC088` |
| warning (amber) | `#A06408` | `#EAAE43` |
| danger (red) | `#A12626` | `#E37373` |
| info (blue) | `#1D5493` | `#639FDB` |

Each has a `*Subtle` background variant (light: tint `50`; dark: dark tint) for
chips, table rows and banners. Full ramps are exported as `ramps` for data-viz.

### Resolved theme roles
`bg, surface, surfaceAlt, border, textPrimary, textSecondary, textMuted, accent,
accentHover, onAccent, accentSubtle, success/warning/danger/info (+ *Subtle),
focusRing`. See `lightColors` / `darkColors` in `src/color.ts` (bundled into the
`lightTheme` / `darkTheme` `Theme` objects in `src/theme.ts`).

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
  `elevation` + mode-agnostic `tokens`. `isDark` flag for status bars / imagery.
- **Web:** set `data-theme="dark"` on `<html>` (default = light on `:root`).
  Toggle the attribute to switch; all `var(--sl-*)` update instantly. Respect
  `prefers-color-scheme` for the initial value, persist the user choice.
- **Native:** a `ThemeProvider` + `useTheme()` context holding `light`/`dark`.
  Seed from `Appearance.getColorScheme()`, allow override, persist.

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
