/**
 * SiteLink back end — date helpers. Wire DTOs use ISO strings (ISODate); Prisma
 * uses Date. These normalise both directions, plus week/month bucketing for the
 * Working Hours aggregate (FR-MGR-ATT-2).
 */
import type { ISODate } from '@sitelink/shared';

/** Date | null → ISO string | null. */
export function toISO(d: Date | null | undefined): ISODate | null {
  return d ? d.toISOString() : null;
}

/** Date → ISO string (non-null). */
export function toISORequired(d: Date): ISODate {
  return d.toISOString();
}

/** Date → YYYY-MM-DD (date-only column). */
export function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Parse a required ISO date; throws-free — validation happens at the Zod edge. */
export function parseDate(iso: ISODate): Date {
  return new Date(iso);
}

/** Monday-start ISO week key, e.g. "2026-W28". */
export function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((date.getTime() - firstThursday.getTime()) / 86400000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    );
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Month key, e.g. "2026-07". */
export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
