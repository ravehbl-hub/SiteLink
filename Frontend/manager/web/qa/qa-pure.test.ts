/**
 * Bugo (Web QA) — regression guards for load-bearing pure logic.
 * Runs with the workspace-resident vitest (no new deps). These mirror the exact
 * branch logic in lib/api/client.ts (envelope unwrap) and lib/format.ts helpers,
 * which are otherwise coupled to import.meta.env / i18next and hard to import in
 * isolation. If the source logic changes, update these in lockstep.
 */
import { describe, it, expect } from 'vitest';

/* ── API error-envelope unwrap (client.ts lines 95-101) ─────────────────── */
interface Env { code: string; message: string; details?: unknown }
function unwrapEnvelope(status: number, parsed: unknown): Env {
  return parsed && typeof parsed === 'object' && 'error' in parsed
    ? (parsed as { error: Env }).error
    : { code: 'UNKNOWN', message: `Request failed (${status})` };
}

describe('API envelope unwrap', () => {
  it('extracts the { error } envelope from the back end', () => {
    const e = unwrapEnvelope(403, { error: { code: 'FORBIDDEN', message: 'no' } });
    expect(e.code).toBe('FORBIDDEN');
    expect(e.message).toBe('no');
  });
  it('falls back to UNKNOWN when body has no error field', () => {
    const e = unwrapEnvelope(500, { something: true });
    expect(e.code).toBe('UNKNOWN');
    expect(e.message).toBe('Request failed (500)');
  });
  it('falls back to UNKNOWN for empty/undefined body', () => {
    const e = unwrapEnvelope(502, undefined);
    expect(e.code).toBe('UNKNOWN');
  });
});

/* ── Date helpers (format.ts) ───────────────────────────────────────────── */
function toDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}
function dateInputToISO(value: string): string {
  if (!value) return '';
  return new Date(`${value}T00:00:00.000Z`).toISOString();
}
function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { from: from.toISOString(), to: to.toISOString() };
}

describe('date helpers', () => {
  it('toDateInput slices ISO to YYYY-MM-DD and guards null', () => {
    expect(toDateInput('2026-07-12T00:00:00.000Z')).toBe('2026-07-12');
    expect(toDateInput(null)).toBe('');
    expect(toDateInput(undefined)).toBe('');
  });
  it('dateInputToISO round-trips a date-only value to midnight UTC', () => {
    expect(dateInputToISO('2026-07-12')).toBe('2026-07-12T00:00:00.000Z');
    expect(dateInputToISO('')).toBe('');
  });
  it('currentMonthRange spans first→last day of the current month', () => {
    const { from, to } = currentMonthRange();
    expect(from.slice(8, 10)).toBe('01');
    expect(new Date(from).getUTCDate()).toBe(1);
    // last day: adding one day rolls into next month
    const next = new Date(to); next.setUTCDate(next.getUTCDate() + 1);
    expect(next.getUTCDate()).toBe(1);
  });
});
