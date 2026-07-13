/** Small formatting helpers (money, dates) — locale-agnostic, safe defaults. */
export function money(amount: number, currency = 'ILS'): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function shortDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

export function isoDate(d: Date): string {
  return d.toISOString();
}

/** First day of the current month → now, as ISO, for default dashboard windows. */
export function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: from.toISOString(), to: now.toISOString() };
}

/** Dashboard date presets (FR-FOR-2 date filter: All / Today / Week / Month). */
export type DatePreset = 'all' | 'today' | 'week' | 'month';

/**
 * Resolve a preset to a from/to ISO window. 'all' → undefined bounds (server
 * returns the full history for the site).
 */
export function presetRange(preset: DatePreset): { from?: string; to?: string } {
  const now = new Date();
  const to = now.toISOString();
  switch (preset) {
    case 'today': {
      const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return { from: from.toISOString(), to };
    }
    case 'week': {
      const from = new Date(now);
      from.setDate(now.getDate() - 6);
      from.setHours(0, 0, 0, 0);
      return { from: from.toISOString(), to };
    }
    case 'month':
      return currentMonthRange();
    case 'all':
    default:
      return {};
  }
}
