/**
 * Locale-aware formatting helpers (FR-X-I18N-5).
 */
import i18n from '../i18n';

export function formatNumber(value: number, opts?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(i18n.language, opts).format(value);
}

export function formatCurrency(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(i18n.language, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${formatNumber(value)} ${currency}`;
  }
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(d);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
}

/** YYYY-MM-DD for <input type="date">. */
export function toDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}

/** A date-only string → ISO datetime at midnight UTC (back end expects datetime). */
export function dateInputToISO(value: string): string {
  if (!value) return '';
  return new Date(`${value}T00:00:00.000Z`).toISOString();
}

/** First and last day of the current month as ISO datetimes. */
export function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { from: from.toISOString(), to: to.toISOString() };
}
