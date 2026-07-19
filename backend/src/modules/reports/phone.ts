/**
 * SiteLink back end — phone normalization for the WhatsApp payslip-share link
 * (Servio). Produces INTERNATIONAL digits-only (E.164-ish, NO leading '+') so the
 * front end can build `https://wa.me/<phone>?text=...` (wa.me wants bare digits).
 *
 * RULES (documented, deterministic):
 *   1. Strip everything that isn't a digit or a leading '+': spaces, dashes,
 *      parentheses, dots. A single leading '+' is remembered then dropped.
 *   2. Israeli LOCAL form '0XXXXXXXXX' (leading zero, no country code) →
 *      '972XXXXXXXXX' (strip the leading 0, prepend the Israel country code 972).
 *   3. Otherwise the number is assumed to ALREADY carry a country code (whether it
 *      came in as '+972…', '00972…', or '972…') and is kept as digits-only. A
 *      leading international '00' prefix is normalised to nothing (drop it).
 *   4. Plausibility: the result must be 8–15 digits (ITU E.164 max is 15). Too
 *      short/long → return null so the caller returns a clean 400.
 */

const IL_COUNTRY_CODE = '972';

export function normalizePhoneForWhatsApp(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();

  // Preserve intent of a leading '+' (explicit international), then keep digits only.
  const hadPlus = trimmed.startsWith('+');
  let digits = trimmed.replace(/\D/g, '');
  if (digits.length === 0) return null;

  if (hadPlus) {
    // Explicit '+CC…' — already international. Digits are the full number.
  } else if (digits.startsWith('00')) {
    // '00CC…' international access prefix → drop the '00'.
    digits = digits.slice(2);
  } else if (digits.startsWith('0')) {
    // Israeli local '0XXXXXXXXX' → '972XXXXXXXXX'.
    digits = IL_COUNTRY_CODE + digits.slice(1);
  }
  // else: bare digits already starting with a country code (e.g. '972…') — keep.

  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}
