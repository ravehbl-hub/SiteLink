/** Requests inbox (FR-REQ): the worker-SUBMISSION queue where a Manager reviews
 *  pending LOAN / ADVANCE / VACATION requests and approves or rejects them. This
 *  is distinct from the Finance screen — approving a request triggers back-end
 *  side-effects that CREATE the loan/advance/attendance records that Finance then
 *  manages. Defaults to the PENDING filter (needs action); a control switches to
 *  APPROVED / REJECTED / all. Consumes the Paginated `.items` array.
 *
 *  The WorkerRequest DTO references only `workerId` (no embedded name), so worker
 *  names are resolved by joining against the shared workers list query. */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { WorkerRequest } from '@sitelink/shared';
import { RequestStatus, RequestType, Role } from '@sitelink/shared';
import { requestsApi } from '../../lib/api/endpoints';
import { qk } from '../../lib/api/queryKeys';
import { useWorkersList } from '../../lib/api/hooks';
import { ApiError } from '../../lib/api/client';
import { useAuth } from '../../app/AuthProvider';
import { DataState, Chip, Modal, Field } from '../../components/ui';
import { formatCurrency, formatDate } from '../../lib/format';

type StatusFilter = RequestStatus | 'ALL';

const TYPE_ICON: Record<RequestType, string> = {
  [RequestType.LOAN]: '₪',
  [RequestType.ADVANCE]: '⇄',
  [RequestType.VACATION]: '⛱',
};

const STATUS_TONE: Record<RequestStatus, 'warning' | 'success' | 'danger'> = {
  [RequestStatus.PENDING]: 'warning',
  [RequestStatus.APPROVED]: 'success',
  [RequestStatus.REJECTED]: 'danger',
};

export function RequestsScreen() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<StatusFilter>('ALL');

  const params = filter === 'ALL' ? {} : { status: filter };
  const query = useQuery({
    queryKey: qk.requests(params),
    queryFn: () => requestsApi.list(params),
  });

  // Resolve worker names (DTO carries only workerId) via the shared workers list.
  const workers = useWorkersList();
  const workerName = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of workers.data?.items ?? []) {
      map.set(w.id, `${w.firstName} ${w.lastName}`.trim());
    }
    return (id: string) => map.get(id) ?? id;
  }, [workers.data]);

  const items = query.data?.items ?? [];

  const FILTERS: StatusFilter[] = [
    'ALL',
    RequestStatus.PENDING,
    RequestStatus.APPROVED,
    RequestStatus.REJECTED,
  ];

  return (
    <div className="deck">
      <div className="page-header">
        <h1 className="section-title" style={{ margin: 0 }}>
          {t('nav.requests')}
        </h1>
        <span className="header-spacer" />
        <div className="segmented" role="group" aria-label={t('common.status')}>
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
            >
              {f === 'ALL' ? t('requests.filterAll') : t(`requestStatus.${f}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="card deck-panel">
        <DataState
          isLoading={query.isLoading || workers.isLoading}
          error={query.error}
          isEmpty={items.length === 0}
        >
          <div className="table-wrap">
            <table className="data data-compact">
              <thead>
                <tr>
                  <th>{t('requests.worker')}</th>
                  <th>{t('requests.type')}</th>
                  <th>{t('requests.detail')}</th>
                  <th>{t('requests.submitted')}</th>
                  <th>{t('common.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <RequestRow key={r.id} req={r} workerName={workerName(r.workerId)} />
                ))}
              </tbody>
            </table>
          </div>
        </DataState>
      </div>
    </div>
  );
}

function RequestRow({ req, workerName }: { req: WorkerRequest; workerName: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<RequestStatus | null>(null);
  const [showRedecide, setShowRedecide] = useState(false);

  // Re-decide (a financial reversal) also touches the ledger/attendance records the
  // side effect created, so invalidate the finance + dashboard queries too.
  const invalidateSideEffects = () => {
    qc.invalidateQueries({ queryKey: ['requests'] });
    qc.invalidateQueries({ queryKey: ['loans'] });
    qc.invalidateQueries({ queryKey: ['advances'] });
    qc.invalidateQueries({ queryKey: ['attendance'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: ['working-hours'] });
  };

  const resolveMut = useMutation({
    mutationFn: (action: 'approve' | 'reject') =>
      action === 'approve' ? requestsApi.approve(req.id) : requestsApi.reject(req.id),
    onSuccess: (_data, action) => {
      setError(null);
      setDone(action === 'approve' ? RequestStatus.APPROVED : RequestStatus.REJECTED);
      invalidateSideEffects();
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        setError(e.status === 409 ? t('requests.alreadyResolved') : e.message);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
  });

  const isPending = req.status === RequestStatus.PENDING;
  const isResolved =
    req.status === RequestStatus.APPROVED || req.status === RequestStatus.REJECTED;
  // ADMIN/MANAGER only. Re-decide is available ONLY on already-RESOLVED rows.
  const canManage = user?.role === Role.ADMIN || user?.role === Role.MANAGER;
  const canRedecide = canManage && isResolved;

  const detail =
    req.type === RequestType.VACATION
      ? `${formatDate(req.startDate)} – ${formatDate(req.endDate)}`
      : req.amount != null
        ? formatCurrency(req.amount, req.currency ?? 'ILS')
        : '—';

  return (
    <tr>
      <td>{workerName}</td>
      <td>
        <span className="req-type">
          <span aria-hidden="true">{TYPE_ICON[req.type]}</span> {t(`requestType.${req.type}`)}
        </span>
      </td>
      <td className="num">{detail}</td>
      <td className="num">{formatDate(req.createdAt)}</td>
      <td>
        <Chip tone={STATUS_TONE[req.status]}>{t(`requestStatus.${req.status}`)}</Chip>
      </td>
      <td>
        {isPending ? (
          done ? (
            <span className="req-confirm">{t('requests.resolved')}</span>
          ) : (
            <div className="row-actions">
              <button
                className="btn btn-sm btn-primary"
                disabled={resolveMut.isPending}
                onClick={() => resolveMut.mutate('approve')}
              >
                {t('requests.confirm')}
              </button>
              <button
                className="btn btn-sm btn-danger"
                disabled={resolveMut.isPending}
                onClick={() => resolveMut.mutate('reject')}
              >
                {t('requests.reject')}
              </button>
            </div>
          )
        ) : canRedecide ? (
          <button
            className="btn btn-sm"
            onClick={() => {
              setError(null);
              setShowRedecide(true);
            }}
          >
            {t('requests.redecide')}
          </button>
        ) : null}
        {error ? <span className="field-error">{error}</span> : null}
        {showRedecide ? (
          <RedecideModal
            req={req}
            onClose={() => setShowRedecide(false)}
            onSuccess={() => {
              setShowRedecide(false);
              invalidateSideEffects();
            }}
          />
        ) : null}
      </td>
    </tr>
  );
}

/**
 * Re-decide CONFIRM modal — an UNAMBIGUOUS financial reversal. Shows the current
 * status → the flip target and a clear note that the loan/advance/vacation side
 * effect will be reversed/re-applied. Optional resolutionNotes. On confirm →
 * PATCH /requests/:id/redecide. Handles the CAS-conflict + partial-repayment 409s.
 */
function RedecideModal({
  req,
  onClose,
  onSuccess,
}: {
  req: WorkerRequest;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState('');
  const [modalError, setModalError] = useState<string | null>(null);

  // The flip target is the OTHER terminal status.
  const target =
    req.status === RequestStatus.APPROVED
      ? RequestStatus.REJECTED
      : RequestStatus.APPROVED;

  const mutation = useMutation({
    mutationFn: () =>
      requestsApi.redecide(req.id, {
        status: target,
        resolutionNotes: notes.trim() || null,
      }),
    onSuccess: () => onSuccess(),
    onError: (e) => {
      if (e instanceof ApiError) {
        if (e.status === 409) {
          // CAS conflict vs. partial-repayment block — surface the backend message
          // (it distinguishes "changed concurrently" from "has repayments"). Show a
          // clear leading label plus the server detail.
          setModalError(
            /concurrent/i.test(e.message)
              ? t('requests.redecideConflict')
              : e.message,
          );
          return;
        }
        if (e.status === 403) {
          setModalError(t('requests.redecideForbidden'));
          return;
        }
        setModalError(e.message);
        return;
      }
      setModalError(e instanceof Error ? e.message : String(e));
    },
  });

  return (
    <Modal
      title={t('requests.redecideTitle')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={mutation.isPending}>
            {t('common.cancel')}
          </button>
          <button
            className="btn btn-danger"
            disabled={mutation.isPending}
            onClick={() => {
              setModalError(null);
              mutation.mutate();
            }}
          >
            {t('requests.redecideConfirm')}
          </button>
        </>
      }
    >
      <div className="stack">
        <p style={{ margin: 0 }}>
          {t('requests.redecidePrompt', {
            from: t(`requestStatus.${req.status}`),
            to: t(`requestStatus.${target}`),
          })}
        </p>
        <div
          className="banner banner-warning"
          role="status"
          style={{ display: 'flex', gap: 'var(--sl-space-2, 8px)', alignItems: 'center' }}
        >
          <Chip tone={STATUS_TONE[req.status]}>{t(`requestStatus.${req.status}`)}</Chip>
          <span aria-hidden="true">→</span>
          <Chip tone={STATUS_TONE[target]}>{t(`requestStatus.${target}`)}</Chip>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          {t('requests.redecideSideEffectNote')}
        </p>
        <Field label={t('requests.resolutionNotes')}>
          <textarea
            className="textarea"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t('requests.resolutionNotesHint')}
          />
        </Field>
        {modalError ? <div className="banner banner-danger">{modalError}</div> : null}
      </div>
    </Modal>
  );
}
