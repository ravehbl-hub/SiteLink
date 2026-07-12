/** Common React Query hooks reused across features (site/worker pickers). */
import { useQuery } from '@tanstack/react-query';
import { sitesApi, workersApi } from './endpoints';
import { qk } from './queryKeys';

export function useSitesList(includeArchived = false) {
  return useQuery({
    queryKey: qk.sites({ includeArchived }),
    queryFn: () => sitesApi.list({ includeArchived, pageSize: 200 }),
  });
}

export function useWorkersList(includeArchived = false) {
  return useQuery({
    queryKey: qk.workers({ includeArchived, all: true }),
    queryFn: () => workersApi.list({ includeArchived, pageSize: 200 }),
  });
}
