/** Loans + Advance payments per worker (FR-MGR-LOAN / FR-MGR-ADV):
 *  select a worker, view/add/modify/remove loans and advances. */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { AdvancePayment, Loan } from '@sitelink/shared';
import { financeApi } from '../../lib/api/endpoints';
import { qk } from '../../lib/api/queryKeys';
import { useWorkersList } from '../../lib/api/hooks';
import { DataState, Modal, Field } from '../../components/ui';
import { formatCurrency, formatDate, toDateInput, dateInputToISO } from '../../lib/format';

type Kind = 'loan' | 'advance';

export function FinanceScreen() {
  const { t } = useTranslation();
  const workers = useWorkersList();
  const [workerId, setWorkerId] = useState('');

  return (
    <div>
      <div className="page-header">
        <h1 className="section-title" style={{ margin: 0 }}>
          {t('nav.finance')}
        </h1>
      </div>

      <div className="card">
        <Field label={t('finance.selectWorker')}>
          <select
            className="select"
            value={workerId}
            onChange={(e) => setWorkerId(e.target.value)}
            style={{ maxWidth: 360 }}
          >
            <option value="">{t('finance.selectWorker')}</option>
            {workers.data?.items.map((w) => (
              <option key={w.id} value={w.id}>
                {w.firstName} {w.lastName}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {workerId ? (
        <>
          <LedgerTable kind="loan" workerId={workerId} />
          <LedgerTable kind="advance" workerId={workerId} />
        </>
      ) : (
        <div className="empty-state">{t('finance.selectWorker')}</div>
      )}
    </div>
  );
}

function LedgerTable({ kind, workerId }: { kind: Kind; workerId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const params = { workerId, pageSize: 100 };

  const query = useQuery({
    queryKey: kind === 'loan' ? qk.loans(params) : qk.advances(params),
    queryFn: () =>
      kind === 'loan' ? financeApi.listLoans(params) : financeApi.listAdvances(params),
  });

  // A loan/advance write moves the dashboard finance rollup (loansTotal /
  // advancePaymentsTotal → netProfit), so invalidate the dashboard too — matches
  // the re-decide path in RequestsScreen.
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: [kind === 'loan' ? 'loans' : 'advances'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const removeMut = useMutation({
    mutationFn: (id: string) =>
      kind === 'loan' ? financeApi.removeLoan(id) : financeApi.removeAdvance(id),
    onSuccess: invalidate,
  });

  const items = (query.data?.items ?? []) as (Loan | AdvancePayment)[];

  return (
    <div className="card">
      <div className="page-header" style={{ marginBlockEnd: 'var(--sl-space-3)' }}>
        <h3 className="subsection-title" style={{ margin: 0 }}>
          {kind === 'loan' ? t('finance.loans') : t('finance.advances')}
        </h3>
        <div className="header-spacer" />
        <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
          {kind === 'loan' ? t('finance.newLoan') : t('finance.newAdvance')}
        </button>
      </div>
      <DataState isLoading={query.isLoading} error={query.error} isEmpty={items.length === 0}>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t('common.date')}</th>
                <th>{t('common.amount')}</th>
                <th>{t('finance.outstanding')}</th>
                <th>{t('common.notes')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td>{formatDate(it.date)}</td>
                  <td>{formatCurrency(it.amount, it.currency)}</td>
                  <td>{formatCurrency(it.outstanding, it.currency)}</td>
                  <td>{it.notes ?? '—'}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => removeMut.mutate(it.id)}
                      >
                        {t('common.remove')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DataState>
      {creating ? (
        <LedgerForm kind={kind} workerId={workerId} onClose={() => setCreating(false)} />
      ) : null}
    </div>
  );
}

function LedgerForm({
  kind,
  workerId,
  onClose,
}: {
  kind: Kind;
  workerId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [amount, setAmount] = useState(0);
  const [currency, setCurrency] = useState('ILS');
  const [date, setDate] = useState(toDateInput(new Date().toISOString()));
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: async () => {
      const body = {
        workerId,
        amount,
        currency,
        date: dateInputToISO(date),
        notes: notes || null,
      };
      return kind === 'loan' ? financeApi.createLoan(body) : financeApi.createAdvance(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [kind === 'loan' ? 'loans' : 'advances'] });
      // Creating a loan/advance changes the dashboard finance rollup too.
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  return (
    <Modal
      title={kind === 'loan' ? t('finance.newLoan') : t('finance.newAdvance')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            className="btn btn-primary"
            disabled={amount <= 0 || mut.isPending}
            onClick={() => mut.mutate()}
          >
            {t('common.save')}
          </button>
        </>
      }
    >
      {error ? <div className="banner banner-danger">{error}</div> : null}
      <Field label={t('common.amount')}>
        <input
          className="input"
          type="number"
          min={0}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value) || 0)}
        />
      </Field>
      <Field label={t('common.currency')}>
        <input className="input" value={currency} onChange={(e) => setCurrency(e.target.value)} />
      </Field>
      <Field label={t('common.date')}>
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label={t('common.notes')}>
        <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Modal>
  );
}
