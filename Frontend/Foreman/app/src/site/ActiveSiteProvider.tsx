/**
 * Active-site context (Foreman MULTI-SITE picker). A foreman's authorized scope is the
 * UNION of their primarySiteId + active ForemanSiteAssignment rows (resolved + enforced
 * server-side). This provider owns the CLIENT-side selection: which of those sites the
 * app is currently pointed at. Every scoped screen (Dashboard / Attendance /
 * WorkerRating / Reports) reads `activeSiteId` from here instead of `primarySiteId`.
 *
 * SELECTION LIFECYCLE
 *   - Union comes from `resolvePickableSites` (see below) — today derived from
 *     /auth/me's primarySiteId; a single swap point when the back end ships a
 *     foreman-facing union endpoint (see endpoints.ts `PickableSite`).
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
import { useAuth } from '../auth/AuthProvider';
import type { PickableSite } from '../lib/endpoints';
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
  /** Select a site (must be in the union; ignored otherwise). Persists immediately. */
  setActiveSiteId: (siteId: string) => void;
}

const ActiveSiteContext = createContext<ActiveSiteContextValue | null>(null);

/**
 * Resolve the foreman's pickable-site UNION from the current auth user.
 *
 * SINGLE SWAP POINT. Today the only foreman-authorized site truth on the client is
 * `/auth/me`'s `primarySiteId` (no assignment list, no names — see endpoints.ts). When
 * the back end exposes a foreman-facing union endpoint, replace THIS function's body to
 * fetch it; the provider, picker and all screens stay unchanged.
 */
function resolvePickableSites(primarySiteId: string | null): PickableSite[] {
  if (!primarySiteId) return [];
  return [{ siteId: primarySiteId, name: primarySiteId, isPrimary: true }];
}

/** Pick the fallback selection: primary if present, else the first site, else null. */
function fallbackSiteId(sites: PickableSite[]): string | null {
  const primary = sites.find((s) => s.isPrimary);
  return (primary ?? sites[0])?.siteId ?? null;
}

export function ActiveSiteProvider({ children }: { children: React.ReactNode }) {
  const { primarySiteId, status } = useAuth();
  const sites = useMemo(() => resolvePickableSites(primarySiteId), [primarySiteId]);
  const [activeSiteId, setActiveSiteIdState] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Resolve/restore the selection whenever the union changes (login, refreshMe, or a
  // reassignment reflected in a fresh /auth/me).
  useEffect(() => {
    let active = true;
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
  }, [sites, status]);

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
