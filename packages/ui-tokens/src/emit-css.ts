/**
 * Build-time generator: writes the CSS custom properties to css/tokens.css.
 * Run via `pnpm run build:css` (which runs the compiled dist/emit-css.js).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { emitCss, emitNeumorphicCss } from "./css.js";

const here = dirname(fileURLToPath(import.meta.url));
// dist/emit-css.js -> package root is one level up from dist/
const outPath = resolve(here, "..", "css", "tokens.css");

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, emitCss(), "utf8");

// eslint-disable-next-line no-console
console.log(`[@sitelink/tokens] wrote ${outPath}`);

// ADDITIVE: the neumorphic variant is emitted to a SEPARATE file so tokens.css
// (the Deck output) stays byte-identical. Import it AFTER tokens.css in the app.
const neuPath = resolve(here, "..", "css", "neumorphic.css");
writeFileSync(neuPath, emitNeumorphicCss(), "utf8");

// eslint-disable-next-line no-console
console.log(`[@sitelink/tokens] wrote ${neuPath}`);
