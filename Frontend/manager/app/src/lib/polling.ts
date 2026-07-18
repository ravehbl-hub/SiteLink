/**
 * Smart-polling presets (rapid-data Part 2). Live screens poll on a tuned
 * refetchInterval ONLY while mounted (react-query pauses intervals for unmounted
 * queries). refetchIntervalInBackground stays false everywhere: when the app is
 * backgrounded we stop polling, and the AppState -> focusManager bridge
 * (useAppFocusManager) gives a single catch-up refetch on foreground instead.
 *
 * staleTime is kept short on live screens (data is fresh for only a few seconds)
 * and long on reference data. The global QueryClient staleTime is 30_000, so
 * these per-screen values are explicit overrides.
 */

/** Spread into a live-screen useQuery to enable tuned smart polling. */
export const live = (intervalMs: number, staleMs: number) =>
  ({
    refetchInterval: intervalMs,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: staleMs,
  }) as const;

/** Tuned intervals per manager live screen. */
export const POLL = {
  requests: 15_000,
  attendance: 20_000,
  dashboard: 30_000, // heavy rollup — don't hammer
} as const;

/** Short staleness for live data; longer for reference lookups. */
export const STALE = {
  live: 5_000,
  reference: 5 * 60_000,
} as const;
