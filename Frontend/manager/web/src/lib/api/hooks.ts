/** Common React Query hooks reused across features (site/worker pickers). */
import { useQuery } from '@tanstack/react-query';
import { sitesApi, workersApi } from './endpoints';
import { qk } from './queryKeys';

// These two are REFERENCE/PICKER lists reused across many screens (dashboard,
// attendance, requests name-join, worker filters). They change rarely, so a long
// 5-minute staleTime stops them refetching on every screen mount; a window-focus
// refetch (global default) and mutation invalidation still keep them current.
const REFERENCE_STALE_TIME = 5 * 60_000;

export function useSitesList(includeArchived = false) {
  return useQuery({
    queryKey: qk.sites({ includeArchived }),
    queryFn: () => sitesApi.list({ includeArchived, pageSize: 200 }),
    staleTime: REFERENCE_STALE_TIME,
  });
}

export function useWorkersList(includeArchived = false) {
  return useQuery({
    queryKey: qk.workers({ includeArchived, all: true }),
    queryFn: () => workersApi.list({ includeArchived, pageSize: 200 }),
    staleTime: REFERENCE_STALE_TIME,
  });
}
