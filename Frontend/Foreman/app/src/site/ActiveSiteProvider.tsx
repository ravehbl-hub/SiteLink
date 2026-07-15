/**
 * Active-site context (Foreman MULTI-SITE picker). A foreman's authorized scope is the
 * UNION of their primarySiteId + active ForemanSiteAssignment rows (resolved + enforced
 * server-side). This provider owns the CLIENT-side selection: which of those sites the
 * app is currently pointed at. Every scoped screen (Dashboard / Attendance /
 * WorkerRating / Reports) reads `activeSiteId` from here instead of `primarySiteId`.
 *
 * SELECTION LIFECYCLE
 *   - Union comes from the SELF-scoped `GET /foreman-sites` (react-query), which returns
 *     the foreman's real scope union WITH site names: `PickableSite[]` =
 *     { siteId, name, isPrimary, status } (from @sitelink/shared). Empty union → [].
 *   - On launch we restore the persisted selection (secure-store
 *     `sitelink_foreman_active_site`). If the persisted site is NO LONGER in the union
 *     (foreman unassigned since), we FALL BACK to primary → first available and rewrite
 *     the pref. A never-persisted foreman defaults to primary → first.
 *   - Selecting a site persists it immediately.
 *
 * CASES
 *   - Empty union  → activeSiteId = null; screens show the "no site assigned" state and
 *     never send an empty siteId (queries stay disabled → no 403 spam).
 *   - Single site  → activeSiteId fixed to it; the picker renders read-only.
 *   - Multi-site   → the picker is active; selection drives every scoped query.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { endpoints } from '../lib/endpoints';
import type { PickableSite } from '../lib/endpoints';
import { qk } from '../lib/queryKeys';
import { loadActiveSitePref, saveActiveSitePref } from '../lib/prefs';

interface ActiveSiteContextValue {
  /** The foreman's full pickable union (may be empty). */
  sites: PickableSite[];
  /** The currently-selected site id, or null when the union is empty. */
  activeSiteId: string | null;
  /** The selected site object (convenience), or null. */
  activeSite: PickableSite | null;
  /** True once the union + persisted selection have resolved (avoids a flash). */
  ready: boolean;
  /** True while the union is being fetched and hasn't resolved yet. */
  loading: boolean;
  /** Select a site (must be in the union; ignored otherwise). Persists immediately. */
  setActiveSiteId: (siteId: string) => void;
}

const ActiveSiteContext = createContext<ActiveSiteContextValue | null>(null);

/** Pick the fallback selection: primary if present, else the first site, else null. */
function fallbackSiteId(sites: PickableSite[]): string | null {
  const primary = sites.find((s) => s.isPrimary);
  return (primary ?? sites[0])?.siteId ?? null;
}

export function ActiveSiteProvider({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();

  // The pickable UNION — real names — from the SELF-scoped GET /foreman-sites. Only
  // fetch once we have an authenticated session (avoids a guaranteed 401/403 pre-login).
  const sitesQ = useQuery({
    queryKey: qk.foremanSites,
    queryFn: () => endpoints.foremanSites(),
    enabled: status === 'signedIn',
  });
  const sites = useMemo<PickableSite[]>(() => sitesQ.data ?? [], [sitesQ.data]);

  const [activeSiteId, setActiveSiteIdState] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // While the union is still loading (fetching, or session not yet authenticated) we are
  // NOT ready — screens show the loading affordance instead of flashing the empty state.
  const unionLoading = status !== 'signedIn' || sitesQ.isPending;

  // Resolve/restore the selection whenever the union changes (login, refetch, or a
  // reassignment reflected in a fresh /foreman-sites).
  useEffect(() => {
    let active = true;
    if (unionLoading) {
      setReady(false);
      return () => {
        active = false;
      };
    }
    setReady(false);
    void (async () => {
      // Empty union → no selection at all; nothing to persist/restore.
      if (sites.length === 0) {
        if (!active) return;
        setActiveSiteIdState(null);
        setReady(true);
        return;
      }
      const stored = await loadActiveSitePref();
      if (!active) return;
      const inUnion = stored && sites.some((s) => s.siteId === stored);
      const next = inUnion ? (stored as string) : fallbackSiteId(sites);
      setActiveSiteIdState(next);
      // Rewrite the pref if we had to fall back (stale/missing selection).
      if (next && next !== stored) void saveActiveSitePref(next);
      setReady(true);
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sites, unionLoading]);

  const setActiveSiteId = useCallback(
    (siteId: string) => {
      if (!sites.some((s) => s.siteId === siteId)) return; // ignore off-union ids
      setActiveSiteIdState(siteId);
      void saveActiveSitePref(siteId);
    },
    [sites],
  );

  const value = useMemo<ActiveSiteContextValue>(
    () => ({
      sites,
      activeSiteId,
      activeSite: sites.find((s) => s.siteId === activeSiteId) ?? null,
      ready,
      loading: !ready,
      setActiveSiteId,
    }),
    [sites, activeSiteId, ready, setActiveSiteId],
  );

  return <ActiveSiteContext.Provider value={value}>{children}</ActiveSiteContext.Provider>;
}

export function useActiveSite(): ActiveSiteContextValue {
  const ctx = useContext(ActiveSiteContext);
  if (!ctx) throw new Error('useActiveSite must be used within ActiveSiteProvider');
  return ctx;
}
