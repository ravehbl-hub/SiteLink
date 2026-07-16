/**
 * Usage (FR-BO-2/3, ADMIN-only).
 *
 * Filter usage rows by customer (+ optional metric) via GET /backoffice/usage
 * and create new ones. The list endpoint returns a Paginated<Usage> envelope —
 * we consume `.items`, never the bare response.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { CreateUsageInput } from '@sitelink/shared';
import { customersApi, usageApi } from '../../lib/api/endpoints';
import { qk } from '../../lib/api/queryKeys';
import { DataState, Field, Modal } from '../../components/ui';
import { formatNumber, formatDate, dateInputToISO } from '../../lib/format';

export function UsageScreen() {
  const { t } = useTranslation();
  const [customerId, setCustomerId] = useState('');
  const [metric, setMetric] = useState('');
  const [creating, setCreating] = useState(false);

  const customers = useQuery({
    queryKey: qk.customers({ includeArchived: true }),
    queryFn: () => customersApi.list({ includeArchived: true }),
  });
  const customerItems = customers.data?.items ?? [];

  const params = {
    ...(customerId ? { customerId } : {}),
    ...(metric.trim() ? { metric: metric.trim() } : {}),
  };
  const list = useQuery({
    queryKey: qk.usage(params),
    queryFn: () => usageApi.list(params),
  });
  // Consume the Paginated envelope: `.items`, never a bare array.
  const items = list.data?.items ?? [];

  const nameOf = (id: string) =>
    customerItems.find((c) => c.id === id)?.name ?? id.slice(0, 8);

  return (
    <div>
      <div className="page-header">
        <h1 className="section-title" style={{ margin: 0 }}>
          {t('usage.title')}
        </h1>
        <div className="header-spacer" />
        <button
          className="btn btn-primary"
          disabled={customerItems.length === 0}
          onClick={() => setCreating(true)}
        >
          {t('usage.newRecord')}
        </button>
      </div>

      <div className="card">
        <div className="inline" style={{ marginBlockEnd: 'var(--sl-space-4)' }}>
          <div className="field" style={{ maxWidth: 280, marginBlockEnd: 0 }}>
            <label>{t('usage.filterCustomer')}</label>
            <select
              className="select"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              <option value="">{t('usage.allCustomers')}</option>
              {customerItems.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ maxWidth: 280, marginBlockEnd: 0 }}>
            <label>{t('usage.filterMetric')}</label>
            <input
              className="input"
              type="search"
              value={metric}
              onChange={(e) => setMetric(e.target.value)}
              placeholder={t('usage.metricPlaceholder')}
            />
          </div>
        </div>

        <DataState
          isLoading={list.isLoading}
          error={list.error}
          isEmpty={items.length === 0}
        >
          <div className="table-wrap">
            <table className="data data-compact">
              <thead>
                <tr>
                  <th>{t('usage.customer')}</th>
                  <th>{t('usage.metric')}</th>
                  <th>{t('usage.value')}</th>
                  <th>{t('usage.period')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((u) => (
                  <tr key={u.id}>
                    <td>{nameOf(u.customerId)}</td>
                    <td className="mono">{u.metric}</td>
                    <td>{formatNumber(u.value)}</td>
                    <td>
                      {formatDate(u.periodStart)} – {formatDate(u.periodEnd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataState>
      </div>

      {creating ? (
        <UsageForm
          customers={customerItems.map((c) => ({ id: c.id, name: c.name }))}
          defaultCustomerId={customerId}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </div>
  );
}

function UsageForm({
  customers,
  defaultCustomerId,
  onClose,
}: {
  customers: { id: string; name: string }[];
  defaultCustomerId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [customerId, setCustomerId] = useState(
    defaultCustomerId || customers[0]?.id || '',
  );
  const [metric, setMetric] = useState('');
  const [value, setValue] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [error, setError] = useState<string | null>(null);

  const valid = customerId && metric && value !== '' && periodStart && periodEnd;

  const mut = useMutation({
    mutationFn: async () => {
      const body: CreateUsageInput = {
        customerId,
        metric,
        value: Number(value),
        periodStart: dateInputToISO(periodStart),
        periodEnd: dateInputToISO(periodEnd),
      };
      return usageApi.create(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['usage'] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  return (
    <Modal
      title={t('usage.newRecord')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('usage.cancel')}
          </button>
          <button
            className="btn btn-primary"
            disabled={!valid || mut.isPending}
            onClick={() => mut.mutate()}
          >
            {t('usage.save')}
          </button>
        </>
      }
    >
      {error ? <div className="banner banner-danger">{error}</div> : null}
      <Field label={t('usage.customer')}>
        <select
          className="select"
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
        >
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('usage.metric')}>
        <input
          className="input"
          value={metric}
          onChange={(e) => setMetric(e.target.value)}
          placeholder={t('usage.metricPlaceholder')}
        />
      </Field>
      <Field label={t('usage.value')}>
        <input
          className="input"
          type="number"
          step="any"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </Field>
      <Field label={t('usage.periodStart')}>
        <input
          className="input"
          type="date"
          value={periodStart}
          onChange={(e) => setPeriodStart(e.target.value)}
        />
      </Field>
      <Field label={t('usage.periodEnd')}>
        <input
          className="input"
          type="date"
          value={periodEnd}
          onChange={(e) => setPeriodEnd(e.target.value)}
        />
      </Field>
    </Modal>
  );
}
