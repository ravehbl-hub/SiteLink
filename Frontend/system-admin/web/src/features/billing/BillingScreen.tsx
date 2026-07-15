/**
 * Billing (FR-BO-2, ADMIN-only).
 *
 * Filter billing records by customer (GET /backoffice/billing?customerId) and
 * create new ones. Both list endpoints return a Paginated<T> envelope — we
 * consume `.items`, never the bare response. BillingStatus is surfaced as a
 * semantically-toned chip (TRIALING/ACTIVE/PAST_DUE/CANCELED).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  BillingStatus,
  type Billing,
  type CreateBillingInput,
} from '@sitelink/shared';
import { billingApi, customersApi } from '../../lib/api/endpoints';
import { qk } from '../../lib/api/queryKeys';
import { Chip, DataState, Field, Modal } from '../../components/ui';
import { formatCurrency, formatDate, dateInputToISO } from '../../lib/format';

const STATUS_TONE: Record<
  BillingStatus,
  'success' | 'info' | 'warning' | 'danger'
> = {
  [BillingStatus.TRIALING]: 'info',
  [BillingStatus.ACTIVE]: 'success',
  [BillingStatus.PAST_DUE]: 'warning',
  [BillingStatus.CANCELED]: 'danger',
};

export function BillingScreen() {
  const { t } = useTranslation();
  const [customerId, setCustomerId] = useState('');
  const [creating, setCreating] = useState(false);

  const customers = useQuery({
    queryKey: qk.customers({ includeArchived: true }),
    queryFn: () => customersApi.list({ includeArchived: true }),
  });
  const customerItems = customers.data?.items ?? [];

  const params = customerId ? { customerId } : {};
  const list = useQuery({
    queryKey: qk.billing(params),
    queryFn: () => billingApi.list(params),
  });
  // Consume the Paginated envelope: `.items`, never a bare array.
  const items = list.data?.items ?? [];

  const nameOf = (id: string) =>
    customerItems.find((c) => c.id === id)?.name ?? id.slice(0, 8);

  return (
    <div>
      <div className="page-header">
        <h1 className="section-title" style={{ margin: 0 }}>
          {t('billing.title')}
        </h1>
        <div className="header-spacer" />
        <button
          className="btn btn-primary"
          disabled={customerItems.length === 0}
          onClick={() => setCreating(true)}
        >
          {t('billing.newRecord')}
        </button>
      </div>

      <div className="card">
        <div className="field" style={{ maxWidth: 360, marginBlockEnd: 'var(--sl-space-4)' }}>
          <label>{t('billing.filterCustomer')}</label>
          <select
            className="select"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
          >
            <option value="">{t('billing.allCustomers')}</option>
            {customerItems.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <DataState
          isLoading={list.isLoading}
          error={list.error}
          isEmpty={items.length === 0}
        >
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('billing.customer')}</th>
                  <th>{t('billing.plan')}</th>
                  <th>{t('billing.amount')}</th>
                  <th>{t('billing.status')}</th>
                  <th>{t('billing.period')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((b) => (
                  <tr key={b.id}>
                    <td>{nameOf(b.customerId)}</td>
                    <td>{b.plan}</td>
                    <td>{formatCurrency(b.amount, b.currency)}</td>
                    <td>
                      <Chip tone={STATUS_TONE[b.status]}>
                        {t(`billing.status${b.status}`)}
                      </Chip>
                    </td>
                    <td>
                      {formatDate(b.periodStart)} – {formatDate(b.periodEnd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataState>
      </div>

      {creating ? (
        <BillingForm
          customers={customerItems.map((c) => ({ id: c.id, name: c.name }))}
          defaultCustomerId={customerId}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </div>
  );
}

function BillingForm({
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
  const [plan, setPlan] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('ILS');
  const [status, setStatus] = useState<BillingStatus>(BillingStatus.TRIALING);
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [error, setError] = useState<string | null>(null);

  const valid =
    customerId && plan && amount !== '' && currency && periodStart && periodEnd;

  const mut = useMutation({
    mutationFn: async () => {
      const body: CreateBillingInput = {
        customerId,
        plan,
        amount: Number(amount),
        currency,
        status,
        periodStart: dateInputToISO(periodStart),
        periodEnd: dateInputToISO(periodEnd),
      };
      return billingApi.create(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['billing'] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  return (
    <Modal
      title={t('billing.newRecord')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('billing.cancel')}
          </button>
          <button
            className="btn btn-primary"
            disabled={!valid || mut.isPending}
            onClick={() => mut.mutate()}
          >
            {t('billing.save')}
          </button>
        </>
      }
    >
      {error ? <div className="banner banner-danger">{error}</div> : null}
      <Field label={t('billing.customer')}>
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
      <Field label={t('billing.plan')}>
        <input className="input" value={plan} onChange={(e) => setPlan(e.target.value)} />
      </Field>
      <Field label={t('billing.amount')}>
        <input
          className="input"
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </Field>
      <Field label={t('billing.currency')}>
        <input
          className="input"
          value={currency}
          onChange={(e) => setCurrency(e.target.value.toUpperCase())}
        />
      </Field>
      <Field label={t('billing.status')}>
        <select
          className="select"
          value={status}
          onChange={(e) => setStatus(e.target.value as BillingStatus)}
        >
          {Object.values(BillingStatus).map((s) => (
            <option key={s} value={s}>
              {t(`billing.status${s}`)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('billing.periodStart')}>
        <input
          className="input"
          type="date"
          value={periodStart}
          onChange={(e) => setPeriodStart(e.target.value)}
        />
      </Field>
      <Field label={t('billing.periodEnd')}>
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

export type { Billing };
