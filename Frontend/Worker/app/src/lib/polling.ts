/**
 * Smart-polling presets (rapid-data Part 2). Live screens poll on a tuned
 * refetchInterval ONLY while mounted (react-query pauses intervals for unmounted
 * queries). refetchIntervalInBackground stays false everywhere: when the app is
 * backgrounded we stop polling, and the AppState -> focusManager bridge
 * (useAppFocusManager) gives a single catch-up refetch on foreground instead.
 *
 * Worker self-data changes rarely, so only "My Requests" polls; Working Hours is
 * focus-only (no interval — it refetches on foreground via the bridge).
 * The global QueryClient staleTime is 30_000, so these per-screen values are
 * explicit overrides.
 */

/** Spread into a live-screen useQuery to enable tuned smart polling. */
export const live = (intervalMs: number, staleMs: number) =>
  ({
    refetchInterval: intervalMs,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: staleMs,
  }) as const;

/** Focus-only: no interval, but catch up on foreground. */
export const focusOnly = (staleMs: number) =>
  ({
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: staleMs,
  }) as const;

/** Tuned intervals per Worker live screen. */
export const POLL = {
  myRequests: 20_000,
} as const;

/** Short staleness for live data; longer for self-data / reference. */
export const STALE = {
  live: 5_000,
  selfData: 60_000,
} as const;
