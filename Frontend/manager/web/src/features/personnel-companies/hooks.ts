/**
 * Personnel Companies data hooks (FR-MGR-EMP-2).
 *
 * Mirrors the sites/workers feature pattern: one `useQuery` for the paginated
 * list, `useMutation` for each write, and a single list invalidation after any
 * mutation so the table refetches. The list query key is scoped by params so
 * the includeArchived toggle keeps its own cache entry.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreatePersonnelCompanyInput,
  PersonnelCompany,
  UpdatePersonnelCompanyInput,
} from '@sitelink/shared';
import { personnelCompaniesApi } from '../../lib/api/endpoints';
import { qk } from '../../lib/api/queryKeys';

/** Broad key so every list variant (archived on/off, any page) is invalidated. */
const LIST_ROOT = ['personnel-companies'];

export function usePersonnelCompaniesList(includeArchived: boolean) {
  const params = { includeArchived, pageSize: 200 };
  // Personnel companies are slow-changing reference data (also used as a picker on
  // the worker form), so a long 5-minute staleTime avoids needless refetches;
  // focus refetch + CRUD invalidation (below) keep it fresh. No polling.
  return useQuery({
    queryKey: qk.personnelCompanies(params),
    queryFn: () => personnelCompaniesApi.list(params),
    staleTime: 5 * 60_000,
  });
}

export function useCreatePersonnelCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePersonnelCompanyInput) => personnelCompaniesApi.create(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_ROOT }),
  });
}

export function useUpdatePersonnelCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdatePersonnelCompanyInput }) =>
      personnelCompaniesApi.update(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_ROOT }),
  });
}

export function useArchivePersonnelCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isArchived }: Pick<PersonnelCompany, 'id' | 'isArchived'>) =>
      isArchived
        ? personnelCompaniesApi.unarchive(id)
        : personnelCompaniesApi.archive(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_ROOT }),
  });
}
