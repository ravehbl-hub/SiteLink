/**
 * SiteLink back end — money + Prisma Decimal helpers.
 *
 * Prisma returns Decimal columns as `Prisma.Decimal` (or a Decimal-like with
 * `.toString()`). The wire DTOs in @sitelink/shared use plain `number`. These
 * helpers normalise both directions and round money to 2 decimals.
 */

/** Coerce a Prisma Decimal / string / number to a JS number. */
export function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  // Prisma.Decimal and Decimal.js expose toString()/toNumber()
  const anyVal = value as { toNumber?: () => number; toString: () => string };
  if (typeof anyVal.toNumber === 'function') return anyVal.toNumber();
  return Number(anyVal.toString());
}

/** Same as toNumber but preserves null (for nullable Decimal columns). */
export function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return toNumber(value);
}

/** Round to 2 decimal places (currency). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
