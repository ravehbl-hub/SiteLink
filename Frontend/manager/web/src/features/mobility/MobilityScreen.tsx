/** Employee mobility (site transfer).
 *  Move a single employee to another site. "Add destination" semantics: the worker
 *  KEEPS their current sites and gains the destination; the effective-day presence
 *  (attendance) record is re-pointed to the destination site (created if the worker
 *  has none that day). ADMIN/MANAGER only. */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { mobilityApi, workersApi } from '../../lib/api/endpoints';
import { qk } from '../../lib/api/queryKeys';
import { useSitesList, useWorkersList } from '../../lib/api/hooks';
import { Field, Chip } from '../../components/ui';
import { toDateInput, dateInputToISO } from '../../lib/format';

export function MobilityScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const workers = useWorkersList();
  const sites = useSitesList();

  const [workerId, setWorkerId] = useState('');
  const [toSiteId, setToSiteId] = useState('');
  const [date, setDate] = useState(toDateInput(new Date().toISOString()));
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ created: boolean } | null>(null);

  // The picked worker's current sites (source context) — shown as chips so the manager
  // sees where the employee is before choosing a destination. Only when a worker is set.
  const detail = useQuery({
    queryKey: qk.worker(workerId),
    queryFn: () => workersApi.get(workerId),
    enabled: Boolean(workerId),
  });
  const currentSiteIds = detail.data?.siteIds ?? [];
  const siteName = (id: string): string =>
    sites.data?.items.find((s) => s.id === id)?.name ?? id;

  const resetResult = () => {
    setError(null);
    setDone(null);
  };

  const mut = useMutation({
    mutationFn: () =>
      mobilityApi.transfer({
        workerId,
        toSiteId,
        date: dateInputToISO(date),
        fromSiteId: currentSiteIds[0] ?? null,
        notes: notes || null,
      }),
    onSuccess: (res) => {
      // The move touches assignments + presence → refresh workers, attendance, dashboard.
      qc.invalidateQueries({ queryKey: ['workers'] });
      qc.invalidateQueries({ queryKey: ['attendance'] });
      qc.invalidateQueries({ queryKey: ['working-hours'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      setError(null);
      setDone({ created: res.presenceCreated });
      setNotes('');
    },
    onError: (e) => {
      setDone(null);
      setError(e instanceof Error ? e.message : String(e));
    },
  });

  const canSubmit = Boolean(workerId && toSiteId && date) && !mut.isPending;

  return (
    <div>
      <div className="page-header">
        <h1 className="section-title" style={{ margin: 0 }}>
          {t('mobility.title')}
        </h1>
      </div>

      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          {t('mobility.hint')}
        </p>

        {error ? <div className="banner banner-danger">{error}</div> : null}
        {done ? (
          <div className="banner banner-info">
            {done.created ? t('mobility.doneCreated') : t('mobility.doneUpdated')}
          </div>
        ) : null}

        <Field label={t('mobility.selectWorker')}>
          <select
            className="select"
            value={workerId}
            onChange={(e) => {
              setWorkerId(e.target.value);
              setToSiteId('');
              resetResult();
            }}
          >
            <option value="">{t('mobility.selectWorker')}</option>
            {workers.data?.items.map((w) => (
              <option key={w.id} value={w.id}>
                {w.firstName} {w.lastName}
              </option>
            ))}
          </select>
        </Field>

        {workerId ? (
          <Field label={t('mobility.currentSites')}>
            {detail.isLoading ? (
              <span className="muted">…</span>
            ) : currentSiteIds.length ? (
              <div className="row-actions" style={{ flexWrap: 'wrap', gap: 6 }}>
                {currentSiteIds.map((id) => (
                  <Chip key={id} tone="neutral">
                    {siteName(id)}
                  </Chip>
                ))}
              </div>
            ) : (
              <span className="muted">{t('mobility.noCurrentSites')}</span>
            )}
          </Field>
        ) : null}

        <div className="form-row">
          <Field label={t('mobility.toSite')}>
            <select
              className="select"
              value={toSiteId}
              onChange={(e) => {
                setToSiteId(e.target.value);
                resetResult();
              }}
              disabled={!workerId}
            >
              <option value="">{t('mobility.selectSite')}</option>
              {sites.data?.items.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {currentSiteIds.includes(s.id) ? ` — ${t('mobility.alreadyThere')}` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('mobility.effectiveDate')}>
            <input
              className="input"
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                resetResult();
              }}
            />
          </Field>
        </div>

        <Field label={t('common.notes')}>
          <textarea
            className="textarea"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>

        <div className="row-actions">
          <button
            className="btn btn-primary"
            disabled={!canSubmit}
            onClick={() => mut.mutate()}
          >
            {t('mobility.move')}
          </button>
        </div>
      </div>
    </div>
  );
}
