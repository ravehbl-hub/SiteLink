/** Worker Wizard (FR-MGR-EMP-1): captures Worker Details + Salary data in steps,
 *  validates required fields, and creates the worker. Docs are added on the detail
 *  screen after creation (signed-URL flow needs a worker id). */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { RateType, type CreateWorkerInput } from '@sitelink/shared';
import { workersApi } from '../../lib/api/endpoints';
import { Field } from '../../components/ui';
import { dateInputToISO } from '../../lib/format';
import {
  WorkerFields,
  emptyWorkerForm,
  validateWorker,
  type WorkerFieldErrors,
  type WorkerFormState,
} from './WorkerFields';

type Step = 0 | 1 | 2;

export function WorkerWizard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>(0);
  const [form, setForm] = useState<WorkerFormState>(emptyWorkerForm);
  const [errors, setErrors] = useState<WorkerFieldErrors>({});
  const [imageName, setImageName] = useState('');

  // Salary data (FR-MGR-EMP-4)
  const [hourlyWage, setHourlyWage] = useState(0);
  const [rateType, setRateType] = useState<RateType>(RateType.HOURLY);
  const [workingConditions, setWorkingConditions] = useState('');
  const [currency, setCurrency] = useState('ILS');
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<WorkerFormState>) => setForm((f) => ({ ...f, ...patch }));

  const create = useMutation({
    mutationFn: () => {
      const body: CreateWorkerInput & {
        salaryData?: {
          hourlyWage: number;
          rateType: RateType;
          workingConditions?: string | null;
          currency: string;
        };
      } = {
        firstName: form.firstName,
        lastName: form.lastName,
        profession: form.profession,
        level: form.level,
        country: form.country || null,
        address: form.address || null,
        qualityOfWorks: form.qualityOfWorks || null,
        phone: form.phone || null,
        email: form.email || null,
        personnelCompany: form.personnelCompany || null,
        residence: form.residence || null,
        startDate: form.startDate ? dateInputToISO(form.startDate) : null,
        siteIds: form.siteIds,
        ...(hourlyWage > 0
          ? {
              salaryData: {
                hourlyWage,
                rateType,
                workingConditions: workingConditions || null,
                currency,
              },
            }
          : {}),
      };
      return workersApi.create(body);
    },
    onSuccess: (worker) => {
      qc.invalidateQueries({ queryKey: ['workers'] });
      navigate(`/workers/${worker.id}`);
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  function goToSalary() {
    const errs = validateWorker(form, t('common.required'));
    setErrors(errs);
    if (Object.keys(errs).length === 0) setStep(1);
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="section-title" style={{ margin: 0 }}>
          {t('workers.newWorker')}
        </h1>
        <div className="header-spacer" />
        <button className="btn" onClick={() => navigate('/workers')}>
          {t('common.cancel')}
        </button>
      </div>

      <div className="steps">
        <div className={`step ${step === 0 ? 'active' : ''}`}>{t('workers.wizardDetails')}</div>
        <div className={`step ${step === 1 ? 'active' : ''}`}>{t('workers.wizardSalary')}</div>
        <div className={`step ${step === 2 ? 'active' : ''}`}>{t('workers.wizardReview')}</div>
      </div>

      <div className="card">
        {error ? <div className="banner banner-danger">{error}</div> : null}

        {step === 0 ? (
          <>
            <Field label={t('workers.image')}>
              <input
                className="input"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => setImageName(e.target.files?.[0]?.name ?? '')}
              />
              {imageName ? <span className="muted">{imageName}</span> : null}
            </Field>
            <WorkerFields form={form} set={set} errors={errors} />
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={goToSalary}>
                {t('common.next')}
              </button>
            </div>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <h3 className="subsection-title">{t('workers.salaryData')}</h3>
            <div className="form-grid">
              <Field label={t('workers.hourlyWage')}>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={hourlyWage}
                  onChange={(e) => setHourlyWage(Number(e.target.value) || 0)}
                />
              </Field>
              <Field label={t('workers.rateType')}>
                <select
                  className="select"
                  value={rateType}
                  onChange={(e) => setRateType(e.target.value as RateType)}
                >
                  {Object.values(RateType).map((r) => (
                    <option key={r} value={r}>
                      {t(`rateType.${r}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('common.currency')}>
                <input className="input" value={currency} onChange={(e) => setCurrency(e.target.value)} />
              </Field>
              <div style={{ gridColumn: '1 / -1' }}>
                <Field label={t('workers.workingConditions')}>
                  <textarea
                    className="textarea"
                    value={workingConditions}
                    onChange={(e) => setWorkingConditions(e.target.value)}
                  />
                </Field>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setStep(0)}>
                {t('common.back')}
              </button>
              <button className="btn btn-primary" onClick={() => setStep(2)}>
                {t('common.next')}
              </button>
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <h3 className="subsection-title">{t('workers.wizardReview')}</h3>
            <dl className="form-grid">
              <ReviewRow label={t('workers.firstName')} value={form.firstName} />
              <ReviewRow label={t('workers.lastName')} value={form.lastName} />
              <ReviewRow label={t('workers.profession')} value={t(`profession.${form.profession}`)} />
              <ReviewRow label={t('workers.level')} value={t(`level.${form.level}`)} />
              <ReviewRow label={t('workers.phone')} value={form.phone || '—'} />
              <ReviewRow label={t('workers.email')} value={form.email || '—'} />
              <ReviewRow
                label={t('workers.hourlyWage')}
                value={hourlyWage > 0 ? `${hourlyWage} ${currency}` : '—'}
              />
              <ReviewRow label={t('workers.image')} value={imageName || '—'} />
            </dl>
            {imageName ? (
              <div className="banner banner-info">
                {/* Worker-image upload endpoint is not exposed in v1 back-end routes. */}
                {t('workers.image')}: {imageName}
              </div>
            ) : null}
            <div className="modal-footer">
              <button className="btn" onClick={() => setStep(1)}>
                {t('common.back')}
              </button>
              <button
                className="btn btn-primary"
                disabled={create.isPending}
                onClick={() => create.mutate()}
              >
                {t('common.finish')}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="kpi-label">{label}</dt>
      <dd style={{ margin: 0 }}>{value}</dd>
    </div>
  );
}
