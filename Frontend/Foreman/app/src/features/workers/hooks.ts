/**
 * Workers data hooks (Foreman surface). Mirrors the app's endpoints + queryKeys +
 * react-query pattern (the Manager app inlines the same primitives; the Foreman
 * personnel-companies feature already factors them into a hooks module — we follow
 * that shape here).
 *
 * Scope: the back end auto-scopes a FOREMAN caller to their assigned site(s), so the
 * list is safe even without an explicit siteId; we still pass the ACTIVE site so the
 * list reflects the SitePicker selection. All mutations invalidate the relevant
 * caches (list on create; list + that worker's detail on update).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateWorkerInput, UpdateWorkerInput } from '@sitelink/shared';
import { endpoints } from '../../lib/endpoints';
import { qk } from '../../lib/queryKeys';
import { live, POLL, STALE } from '../../lib/polling';

/** List workers on a site (undefined → all the foreman's sites, server-scoped). */
export function useWorkersList(siteId?: string, enabled = true) {
  return useQuery({
    queryKey: qk.workers({ siteId }),
    queryFn: () => endpoints.listWorkers({ siteId }),
    enabled,
    // Roster changes rarely — modest poll + foreground catch-up.
    ...live(POLL.workers, STALE.reference),
  });
}

/** Read one worker (WorkerWithDetails). 403 if the worker is off the foreman's sites. */
export function useWorkerDetail(workerId: string | null) {
  return useQuery({
    queryKey: qk.worker(workerId ?? ''),
    queryFn: () => endpoints.getWorker(workerId as string),
    enabled: Boolean(workerId),
    staleTime: STALE.reference,
  });
}

/** Create a worker → invalidate ALL workers lists on success. */
export function useCreateWorker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateWorkerInput) => endpoints.createWorker(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['workers'] });
    },
  });
}

/** Update a worker → invalidate ALL workers lists + this worker's detail. */
export function useUpdateWorker(workerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateWorkerInput) => endpoints.updateWorker(workerId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['workers'] });
      void qc.invalidateQueries({ queryKey: qk.worker(workerId) });
    },
  });
}
