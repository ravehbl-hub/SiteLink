# SiteLink — Cream / Teal Neumorphic (manager-web variant)

**Status:** NEW, opt-in theme variant. **ADDITIVE** — it supersedes "Operations
Deck" *for the manager-web surface only, and only once the user approves the
reskin*. Native apps and every non-reskinned web surface stay on Deck. Nothing in
this variant changes the Deck tokens, `defaultThemeName`, or `css/tokens.css`.

Single source of truth is still **`@sitelink/tokens`** (`packages/ui-tokens`).
Never hard-code a hex/shadow/radius in a screen — read a token.

## What it is

A soft, tactile "extruded plastic" look on a warm cream ground with teal accents.
The signature is **dual-shadow neumorphism**: every RAISED element casts a dark
drop shadow toward the bottom-right AND a light highlight toward the top-left.
INSET (pressed / active / inputs / wells) REVERSES both.

## How to select it

- **Web (manager-web, Maestro):** import `@sitelink/tokens/css/tokens.css`
  **first**, then `@sitelink/tokens/css/neumorphic.css`. Set
  `data-theme="neumorphic"` (light, primary) or `data-theme="neumorphic-dark"` on
  the manager-web root. Deck's `:root` / `[data-theme="light"]` /
  `[data-theme="dark"]` are untouched, so other surfaces are unaffected.
- **Native (later, if approved):** pass `neumorphicLightTheme` /
  `neumorphicDarkTheme` (from `@sitelink/tokens`) to the theme provider. Read
  `theme.neumorphic` for the dual/inset shadow set, extra teal accents, softer
  radii and the label treatment. See the native limitation note below.

## Palette (semantic roles)

| Role | Light | Dark | CSS var |
|---|---|---|---|
| bg | `#EBE4D6` | `#20282A` | `--sl-color-bg` |
| surface | `#F5F0E6` | `#252E30` | `--sl-color-surface` |
| surface2 / alt | `#EAE3D5` | `#1E2628` | `--sl-color-surface-alt` |
| line / border | `#D9D1C0` | `#313B3C` | `--sl-color-border` |
| ink / text | `#3B382F` | `#E7E3D9` | `--sl-color-text-primary` |
| muted | `#928B7C` | `#8B958F` | `--sl-color-text-muted` |
| teal primary (accent) | `#1C5A55` | `#2E827A` | `--sl-color-accent` / `--sl-color-teal-primary` |
| teal deep | `#154440` | `#256A63` | `--sl-color-teal-deep` |
| teal bright | `#2E827A` | `#45B0A4` | `--sl-color-teal-bright` |
| error / danger | `#B85641` | `#C86A55` | `--sl-color-danger` |
| amber / warning | `#C79A5E` | `#C79A5E` | `--sl-color-warning` |
| focus ring | `#2E827A` | `#45B0A4` | `--sl-color-focus-ring` |

**Contrast / WCAG AA:** ink `#3B382F` on cream `#EBE4D6`/`#F5F0E6` ≈ 9:1 — AA/AAA
for body. Muted `#928B7C` passes AA for large/secondary text only — do NOT use it
for body copy. Teal primary `#1C5A55` on cream ≈ 5.9:1 — AA for accent text/icons
and large text. `onAccent` (`#F5F0E6`) on teal primary passes AA for button labels.
Always pair status color with FORM (pill/dot/stripe), never color alone.

## Dual-shadow tokens

Web strings are dual / comma-separated. `sd` = warm dark bottom-right,
`sl` = white ~0.70–0.75 top-left. Inset variants use the `inset` keyword and
reverse the direction.

| Token | CSS var | Light web value |
|---|---|---|
| raised sm | `--sl-shadow-raised-sm` | `3px 3px 6px rgba(58,52,40,.20), -3px -3px 6px rgba(255,255,255,.70)` |
| raised | `--sl-shadow-raised` | `6px 6px 12px rgba(58,52,40,.20), -6px -6px 12px rgba(255,255,255,.70)` |
| raised lg | `--sl-shadow-raised-lg` | `10px 10px 22px rgba(58,52,40,.26), -8px -8px 18px rgba(255,255,255,.75)` |
| inset sm | `--sl-shadow-inset-sm` | `inset 2px 2px 4px …, inset -2px -2px 4px …` |
| inset | `--sl-shadow-inset` | `inset 4px 4px 8px …, inset -4px -4px 8px …` |
| inset lg | `--sl-shadow-inset-lg` | `inset 6px 6px 12px …, inset -6px -6px 12px …` |

JS access: `theme.neumorphic.shadows.raised.web` / `.insetSm.web`, etc.

**Native approximation + LIMITATION.** React Native shadows are outer-only,
single-color, and CANNOT be inset or dual. So:
- A **raised** element uses the closest single dark drop-shadow (bottom-right bias
  via `shadowOffset`, plus Android `elevation`); the light top-left highlight is
  dropped. See `.native` on each shadow token.
- An **inset** element cannot be shadowed at all — `.native.insetUnsupportedOnNative`
  is `true`. Native consumers should render `surfaceAlt` fill + a hairline
  `border` to read "pressed / well".
- Native neumorphism is therefore APPROXIMATE; the full dual/inset effect is
  web-only. A pixel-true native version would need an SVG/gradient layer (out of
  scope for tokens).

## Radii & typography

- **Radii (softer than Deck)** — `neumorphicRadii` / `--sl-radius-neu-*`:
  card `20` (cardLg `22`), control `12` (controlLg `14`), inset well `14`,
  chip/pill `999` (full). The base `radii` scale is unchanged; these are an
  additive parallel scale.
- **Type** — Inter (already the body face). **Small labels / section headers:**
  BOLD, UPPERCASE, widened tracking (`0.1em`), color = muted. Token
  `neumorphicLabel` / vars `--sl-label-size|weight|tracking|transform`. Body =
  normal weight, ink; secondary = muted. **RTL:** do NOT uppercase Hebrew — apply
  `text-transform: uppercase` + the label tracking only in Latin locales.
- **Control heights are UNCHANGED:** `controlSm` 32 / `controlMd` 40 (the
  compaction work is preserved). Neumorphism changes surface + shadow, not height.

## Component-state spec (manager-web)

Apply consistently; every "raised/inset" below maps to the shadow vars above.

- **Button (default / secondary):** surface fill, `--sl-shadow-raised`, radius
  `control` (12). Hover: `raised-sm` (slightly flatter). **Pressed/active:**
  swap to `--sl-shadow-inset`. Height `controlSm`/`controlMd`. Label bold.
- **Button (primary):** teal-primary fill (`--sl-color-accent`), `onAccent` label,
  `raised`; pressed → `inset`. Keep AA (label passes on teal).
- **Input & Select:** **inset well** — `surfaceAlt` fill + `--sl-shadow-inset`,
  radius `well` (14), height `controlSm`. Focus: keep the inset well, add a
  `focus-ring` outline (`--sl-color-focus-ring`, teal bright) via
  `:focus-visible`. Placeholder = muted. Select chevron = muted/teal.
- **Card:** `surface` fill, `--sl-shadow-raised`, radius `card` (20). No heavy
  border — the dual shadow provides separation. Section header inside = the
  uppercase-bold label.
- **Nav item (sidebar):** **active = RAISED** (`--sl-shadow-raised`) with a teal
  accent (teal text/icon or a teal inset stripe) on `surface`. Inactive = FLAT
  (no shadow, ink/muted); hover = `--sl-shadow-inset-sm` (gentle press-in).
  (RTL sidebar sits on the right — layout concern for Maestro; treatment is the
  same.)
- **Table:** `surface` background; header row on `surfaceAlt`. Row separation via
  `--sl-color-border` (line) hairlines, NOT heavy borders and NOT per-row
  shadows. Selected row = `accent-subtle` tint. Keep rows flat for scan density.
- **Chips / pills:** soft, full radius (`chip`/`pill` 999). Resting = `raised-sm`;
  selected/active = `inset-sm` + teal text. Status chips carry a dot/stripe for
  form-encoding.
- **Modal / popover:** `surface`, `--sl-shadow-raised-lg`, radius `cardLg` (22),
  over a dimmed backdrop (`rgba(0,0,0,.35)` light / `.55` dark). Primary action =
  primary button treatment.

**Focus-visible everywhere:** never remove the outline; use
`outline: 2px solid var(--sl-color-focus-ring); outline-offset: 2px` (or a
`box-shadow` ring layered before the neumorphic shadow) so keyboard users always
see focus on the soft surfaces.
