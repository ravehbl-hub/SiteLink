/**
 * Companies (multi-tenancy Phase 1, ADMIN-only).
 *
 * The tenant boundary. Lists companies via GET /companies (Paginated envelope —
 * consume `.items`, never the bare response), with an includeArchived toggle.
 * Create/edit a company (name + optional 1:1 billing-Customer link via a picker
 * drawn from GET /backoffice/customers), and reversible archive/unarchive.
 *
 * "Add manager" creates a User with role=MANAGER and the row's companyId via the
 * EXISTING POST /users endpoint (usersApi.create) — a Manager is created INTO a
 * company, there is no companies sub-route for it. 409 (company↔customer already
 * linked / dup) and 400 (target company archived/missing) surface inline.
 *
 * Neumorphic classes + logical props (RTL-safe) mirror the customers/adminUsers
 * feature pattern. Phase 2 (worker/site company-scoping UI) is NOT built here.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Role,
  type Company,
  type CreateCompanyInput,
  type CreateUserInput,
  type UpdateCompanyInput,
} from '@sitelink/shared';
import { companiesApi, customersApi, usersApi } from '../../lib/api/endpoints';
import { ApiError } from '../../lib/api/client';
import { qk } from '../../lib/api/queryKeys';
import { Chip, DataState, Field, Modal } from '../../components/ui';
import { formatDate } from '../../lib/format';

export function CompaniesScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [addingManager, setAddingManager] = useState<Company | null>(null);

  const params = { includeArchived };
  // Admin CRUD list — not real-time. Focus refetch (global) + mutation
  // invalidation keep it current; 60s staleTime avoids refetch on every mount.
  const list = useQuery({
    queryKey: qk.companies(params),
    queryFn: () => companiesApi.list(params),
    staleTime: 60_000,
  });

  // Customer roster for the picker + the linked-customer name column. Archived
  // included so an already-linked (possibly archived) customer still resolves.
  const customers = useQuery({
    queryKey: qk.customers({ includeArchived: true }),
    queryFn: () => customersApi.list({ includeArchived: true }),
    staleTime: 60_000,
  });
  const customerName = (id?: string | null) =>
    id ? (customers.data?.items.find((c) => c.id === id)?.name ?? id) : null;

  const invalidate = () => qc.invalidateQueries({ queryKey: ['companies'] });
  const archiveMut = useMutation({
    mutationFn: (v: { id: string; archived: boolean }) =>
      v.archived ? companiesApi.unarchive(v.id) : companiesApi.archive(v.id),
    onSuccess: invalidate,
  });

  // Consume the Paginated envelope: `.items`, never a bare array.
  const items = list.data?.items ?? [];

  return (
    <div>
      <div className="page-header">
        <h1 className="section-title" style={{ margin: 0 }}>
          {t('companies.title')}
        </h1>
        <div className="header-spacer" />
        <label className="inline" style={{ gap: 'var(--sl-space-2)' }}>
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          <span>{t('companies.includeArchived')}</span>
        </label>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          {t('companies.newCompany')}
        </button>
      </div>

      <div className="card">
        <DataState
          isLoading={list.isLoading}
          error={list.error}
          isEmpty={items.length === 0}
        >
          <div className="table-wrap">
            <table className="data data-compact">
              <thead>
                <tr>
                  <th>{t('companies.name')}</th>
                  <th>{t('companies.linkedCustomer')}</th>
                  <th>{t('companies.status')}</th>
                  <th>{t('companies.createdAt')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td>{customerName(c.customerId) ?? '—'}</td>
                    <td>
                      {c.isArchived ? (
                        <Chip tone="neutral">{t('companies.archived')}</Chip>
                      ) : (
                        <Chip tone="success">{t('companies.active')}</Chip>
                      )}
                    </td>
                    <td>{formatDate(c.createdAt)}</td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="btn btn-sm"
                          disabled={c.isArchived}
                          onClick={() => setAddingManager(c)}
                        >
                          {t('companies.addManager')}
                        </button>
                        <button className="btn btn-sm" onClick={() => setEditing(c)}>
                          {t('companies.edit')}
                        </button>
                        <button
                          className="btn btn-sm"
                          onClick={() =>
                            archiveMut.mutate({ id: c.id, archived: c.isArchived })
                          }
                        >
                          {c.isArchived
                            ? t('companies.unarchive')
                            : t('companies.archive')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataState>
      </div>

      {creating ? <CompanyForm onClose={() => setCreating(false)} /> : null}
      {editing ? (
        <CompanyForm company={editing} onClose={() => setEditing(null)} />
      ) : null}
      {addingManager ? (
        <AddManagerForm
          company={addingManager}
          onClose={() => setAddingManager(null)}
        />
      ) : null}
    </div>
  );
}

function CompanyForm({
  company,
  onClose,
}: {
  company?: Company;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState(company?.name ?? '');
  const [customerId, setCustomerId] = useState(company?.customerId ?? '');
  const [error, setError] = useState<string | null>(null);

  // Picker options: only non-archived customers (a live billing link).
  const customers = useQuery({
    queryKey: qk.customers({ includeArchived: false }),
    queryFn: () => customersApi.list({ includeArchived: false }),
    staleTime: 60_000,
  });
  const options = customers.data?.items ?? [];

  const mut = useMutation({
    mutationFn: async () => {
      if (company) {
        const body: UpdateCompanyInput = {
          name,
          customerId: customerId || null,
        };
        return companiesApi.update(company.id, body);
      }
      const body: CreateCompanyInput = {
        name,
        customerId: customerId || null,
      };
      return companiesApi.create(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['companies'] });
      onClose();
    },
    onError: (e) => setError(mapCompanyError(e, t)),
  });

  return (
    <Modal
      title={company ? t('companies.edit') : t('companies.newCompany')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('companies.cancel')}
          </button>
          <button
            className="btn btn-primary"
            disabled={!name || mut.isPending}
            onClick={() => mut.mutate()}
          >
            {t('companies.save')}
          </button>
        </>
      }
    >
      {error ? <div className="banner banner-danger">{error}</div> : null}
      <Field label={t('companies.name')}>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label={`${t('companies.linkedCustomer')} (${t('companies.optional')})`}>
        <select
          className="select"
          value={customerId ?? ''}
          onChange={(e) => setCustomerId(e.target.value)}
        >
          <option value="">{t('companies.noCustomer')}</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <span className="muted">{t('companies.linkHint')}</span>
      </Field>
    </Modal>
  );
}

function AddManagerForm({
  company,
  onClose,
}: {
  company: Company;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: async () => {
      const body: CreateUserInput = {
        role: Role.MANAGER,
        fullName,
        email,
        companyId: company.id,
        ...(password ? { password } : {}),
      };
      return usersApi.create(body);
    },
    onSuccess: () => {
      // A new user of this company — keep the users lists fresh too.
      qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: (e) => setError(mapManagerError(e, t)),
  });

  return (
    <Modal
      title={t('companies.addManagerTo', { name: company.name })}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('companies.cancel')}
          </button>
          <button
            className="btn btn-primary"
            disabled={!fullName || !email || mut.isPending}
            onClick={() => mut.mutate()}
          >
            {t('companies.save')}
          </button>
        </>
      }
    >
      {error ? <div className="banner banner-danger">{error}</div> : null}
      <Field label={t('companies.managerName')}>
        <input
          className="input"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
      </Field>
      <Field label={t('companies.managerEmail')}>
        <input
          className="input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field
        label={`${t('companies.managerPassword')} (${t('companies.optional')})`}
      >
        <input
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <span className="muted">{t('companies.passwordHint')}</span>
      </Field>
    </Modal>
  );
}

/** Company create/update errors → friendly copy. 409 = customer already linked
 *  (or dup company); 400 = validation (e.g. linked customer does not exist). */
function mapCompanyError(e: unknown, t: (k: string) => string): string {
  if (e instanceof ApiError) {
    if (e.status === 409) return t('companies.customerLinked');
    if (e.status === 400) return t('companies.invalidLink');
  }
  return e instanceof Error ? e.message : String(e);
}

/** Add-manager errors → friendly copy. 409/USER_EMAIL_EXISTS = dup email;
 *  400 = the company is not a real/live tenant (archived or gone). */
function mapManagerError(e: unknown, t: (k: string) => string): string {
  if (e instanceof ApiError) {
    if (e.code === 'USER_EMAIL_EXISTS' || e.status === 409)
      return t('companies.emailExists');
    if (e.status === 400) return t('companies.companyNotLive');
  }
  return e instanceof Error ? e.message : String(e);
}
