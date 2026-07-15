/**
 * Customers (SaaS tenants, FR-BO-1/2, ADMIN-only).
 *
 * Lists SiteLink's own SaaS customers via GET /backoffice/customers. The list
 * endpoint returns a Paginated<Customer> envelope — we consume `.items`, never
 * the bare response. An includeArchived toggle re-queries the archived rows.
 * Create (modal: name + contacts + registeredAt), edit (PATCH), and reversible
 * archive/unarchive round out the CRUD.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type {
  Customer,
  CreateCustomerInput,
  UpdateCustomerInput,
} from '@sitelink/shared';
import { customersApi } from '../../lib/api/endpoints';
import { qk } from '../../lib/api/queryKeys';
import { Chip, DataState, Field, Modal } from '../../components/ui';
import { formatDate, dateInputToISO, toDateInput } from '../../lib/format';

export function CustomersScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);

  const params = { includeArchived };
  const list = useQuery({
    queryKey: qk.customers(params),
    queryFn: () => customersApi.list(params),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['customers'] });
  const archiveMut = useMutation({
    mutationFn: (v: { id: string; archived: boolean }) =>
      v.archived ? customersApi.unarchive(v.id) : customersApi.archive(v.id),
    onSuccess: invalidate,
  });

  // Consume the Paginated envelope: `.items`, never a bare array.
  const items = list.data?.items ?? [];

  return (
    <div>
      <div className="page-header">
        <h1 className="section-title" style={{ margin: 0 }}>
          {t('customers.title')}
        </h1>
        <div className="header-spacer" />
        <label className="inline" style={{ gap: 'var(--sl-space-2)' }}>
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          <span>{t('customers.includeArchived')}</span>
        </label>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          {t('customers.newCustomer')}
        </button>
      </div>

      <div className="card">
        <DataState
          isLoading={list.isLoading}
          error={list.error}
          isEmpty={items.length === 0}
        >
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('customers.name')}</th>
                  <th>{t('customers.contactEmail')}</th>
                  <th>{t('customers.contactPhone')}</th>
                  <th>{t('customers.status')}</th>
                  <th>{t('customers.registeredAt')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td>{c.contactEmail || '—'}</td>
                    <td>{c.contactPhone || '—'}</td>
                    <td>
                      {c.isArchived ? (
                        <Chip tone="neutral">{t('customers.archived')}</Chip>
                      ) : (
                        <Chip tone="success">{t('customers.active')}</Chip>
                      )}
                    </td>
                    <td>{formatDate(c.registeredAt)}</td>
                    <td>
                      <div className="row-actions">
                        <button className="btn btn-sm" onClick={() => setEditing(c)}>
                          {t('customers.edit')}
                        </button>
                        <button
                          className="btn btn-sm"
                          onClick={() =>
                            archiveMut.mutate({ id: c.id, archived: c.isArchived })
                          }
                        >
                          {c.isArchived
                            ? t('customers.unarchive')
                            : t('customers.archive')}
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

      {creating ? <CustomerForm onClose={() => setCreating(false)} /> : null}
      {editing ? (
        <CustomerForm customer={editing} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}

function CustomerForm({
  customer,
  onClose,
}: {
  customer?: Customer;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState(customer?.name ?? '');
  const [contactEmail, setContactEmail] = useState(customer?.contactEmail ?? '');
  const [contactPhone, setContactPhone] = useState(customer?.contactPhone ?? '');
  const [registeredAt, setRegisteredAt] = useState(
    toDateInput(customer?.registeredAt),
  );
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: async () => {
      if (customer) {
        const body: UpdateCustomerInput = {
          name,
          contactEmail: contactEmail || null,
          contactPhone: contactPhone || null,
          ...(registeredAt ? { registeredAt: dateInputToISO(registeredAt) } : {}),
        };
        return customersApi.update(customer.id, body);
      }
      const body: CreateCustomerInput = {
        name,
        contactEmail: contactEmail || null,
        contactPhone: contactPhone || null,
        ...(registeredAt ? { registeredAt: dateInputToISO(registeredAt) } : {}),
      };
      return customersApi.create(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  return (
    <Modal
      title={customer ? t('customers.edit') : t('customers.newCustomer')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('customers.cancel')}
          </button>
          <button
            className="btn btn-primary"
            disabled={!name || mut.isPending}
            onClick={() => mut.mutate()}
          >
            {t('customers.save')}
          </button>
        </>
      }
    >
      {error ? <div className="banner banner-danger">{error}</div> : null}
      <Field label={t('customers.name')}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={`${t('customers.contactEmail')} (${t('customers.optional')})`}>
        <input
          className="input"
          type="email"
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
        />
      </Field>
      <Field label={`${t('customers.contactPhone')} (${t('customers.optional')})`}>
        <input
          className="input"
          value={contactPhone}
          onChange={(e) => setContactPhone(e.target.value)}
        />
      </Field>
      <Field label={t('customers.registeredAt')}>
        <input
          className="input"
          type="date"
          value={registeredAt}
          onChange={(e) => setRegisteredAt(e.target.value)}
        />
      </Field>
    </Modal>
  );
}
