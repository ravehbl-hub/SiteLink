/**
 * Data hooks for Personnel Companies (FR-MGR-EMP-2). Mirrors the manager-app
 * feature pattern (endpoints wrapper + qk factory + react-query), extracted into
 * a small hook module so the screen/form stay presentational.
 *
 * Mutations invalidate the whole `personnelCompanies` namespace so both the
 * active and includeArchived variants refetch after a create/edit/archive.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreatePersonnelCompanyInput,
  UpdatePersonnelCompanyInput,
} from '@sitelink/shared';
import { endpoints } from '../../lib/endpoints';
import { qk } from '../../lib/queryKeys';

/** List query. `includeArchived` widens the result to archived rows too. */
export function usePersonnelCompanies(includeArchived: boolean) {
  return useQuery({
    queryKey: qk.personnelCompanies({ includeArchived }),
    queryFn: () => endpoints.listPersonnelCompanies({ includeArchived }),
  });
}

/** Invalidate every personnelCompanies list variant (active + archived). */
function useInvalidateList() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['personnelCompanies'] });
}

/** Create a company. onSuccess callers refetch via the shared invalidator. */
export function useCreatePersonnelCompany() {
  const invalidate = useInvalidateList();
  return useMutation({
    mutationFn: (body: CreatePersonnelCompanyInput) => endpoints.createPersonnelCompany(body),
    onSuccess: () => invalidate(),
  });
}

/** Patch an existing company. */
export function useUpdatePersonnelCompany() {
  const invalidate = useInvalidateList();
  return useMutation({
    mutationFn: (v: { id: string; body: UpdatePersonnelCompanyInput }) =>
      endpoints.updatePersonnelCompany(v.id, v.body),
    onSuccess: () => invalidate(),
  });
}

/** Archive / unarchive toggle (POST). */
export function useArchivePersonnelCompany() {
  const invalidate = useInvalidateList();
  return useMutation({
    mutationFn: (v: { id: string; archived: boolean }) =>
      v.archived
        ? endpoints.unarchivePersonnelCompany(v.id)
        : endpoints.archivePersonnelCompany(v.id),
    onSuccess: () => invalidate(),
  });
}

/**
 * Hard-delete a company (DELETE → 204). The backend auto-nulls the
 * personnelCompanyId of any linked workers (FK SetNull), so this is a safe,
 * MANAGER-only destructive action. Invalidates every list variant on success.
 */
export function useDeletePersonnelCompany() {
  const invalidate = useInvalidateList();
  return useMutation({
    mutationFn: (id: string) => endpoints.deletePersonnelCompany(id),
    onSuccess: () => invalidate(),
  });
}
