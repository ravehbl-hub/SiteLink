/** Worker Details view/edit (FR-MGR-EMP-2/4) + Worker Docs signed-URL flow
 *  (FR-MGR-EMP-3, Architecture §7a) + Worker Salary data upsert. */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  RateType,
  WorkerDocType,
  type UpdateWorkerInput,
  type WorkerDoc,
} from '@sitelink/shared';
import { workersApi } from '../../lib/api/endpoints';
import { qk } from '../../lib/api/queryKeys';
import { DataState, Field } from '../../components/ui';
import { dateInputToISO, formatDate, toDateInput } from '../../lib/format';
import {
  WorkerFields,
  validateWorker,
  type WorkerFieldErrors,
  type WorkerFormState,
} from './WorkerFields';

export function WorkerDetail() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const query = useQuery({ queryKey: qk.worker(id), queryFn: () => workersApi.get(id) });

  return (
    <div>
      <div className="page-header">
        <button className="btn btn-sm" onClick={() => navigate('/workers')}>
          {t('common.back')}
        </button>
        <h1 className="section-title" style={{ margin: 0 }}>
          {query.data ? `${query.data.firstName} ${query.data.lastName}` : t('workers.details')}
        </h1>
      </div>

      <DataState isLoading={query.isLoading} error={query.error}>
        {query.data ? (
          <div className="stack">
            <DetailsCard workerId={id} data={query.data} />
            <SalaryCard workerId={id} data={query.data} />
            <DocsCard workerId={id} />
          </div>
        ) : null}
      </DataState>
    </div>
  );
}

function toForm(w: Awaited<ReturnType<typeof workersApi.get>>): WorkerFormState {
  return {
    firstName: w.firstName,
    lastName: w.lastName,
    country: w.country ?? '',
    address: w.address ?? '',
    profession: w.profession,
    level: w.level,
    qualityOfWorks: w.qualityOfWorks ?? '',
    phone: w.phone ?? '',
    email: w.email ?? '',
    personnelCompany: w.personnelCompany ?? '',
    residence: w.residence ?? '',
    startDate: toDateInput(w.startDate),
    siteIds: w.siteIds,
  };
}

function DetailsCard({
  workerId,
  data,
}: {
  workerId: string;
  data: Awaited<ReturnType<typeof workersApi.get>>;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [form, setForm] = useState<WorkerFormState>(() => toForm(data));
  const [errors, setErrors] = useState<WorkerFieldErrors>({});
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<WorkerFormState>) => setForm((f) => ({ ...f, ...patch }));

  const save = useMutation({
    mutationFn: () => {
      const body: UpdateWorkerInput = {
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
      };
      return workersApi.update(workerId, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.worker(workerId) });
      qc.invalidateQueries({ queryKey: ['workers'] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  function onSave() {
    const errs = validateWorker(form, t('common.required'));
    setErrors(errs);
    if (Object.keys(errs).length === 0) save.mutate();
  }

  return (
    <div className="card">
      <h3 className="subsection-title">{t('workers.details')}</h3>
      {error ? <div className="banner banner-danger">{error}</div> : null}
      <WorkerFields form={form} set={set} errors={errors} />
      <div className="modal-footer">
        <button className="btn btn-primary" disabled={save.isPending} onClick={onSave}>
          {t('common.save')}
        </button>
      </div>
    </div>
  );
}

function SalaryCard({
  workerId,
  data,
}: {
  workerId: string;
  data: Awaited<ReturnType<typeof workersApi.get>>;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [hourlyWage, setHourlyWage] = useState(data.salaryData?.hourlyWage ?? 0);
  const [rateType, setRateType] = useState<RateType>(data.salaryData?.rateType ?? RateType.HOURLY);
  const [workingConditions, setWorkingConditions] = useState(
    data.salaryData?.workingConditions ?? '',
  );
  const [currency, setCurrency] = useState(data.salaryData?.currency ?? 'ILS');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      workersApi.upsertSalaryData(workerId, {
        hourlyWage,
        rateType,
        workingConditions: workingConditions || null,
        currency,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.worker(workerId) }),
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  return (
    <div className="card">
      <h3 className="subsection-title">{t('workers.salaryData')}</h3>
      {error ? <div className="banner banner-danger">{error}</div> : null}
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
        <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
          {t('common.save')}
        </button>
      </div>
    </div>
  );
}

function DocsCard({ workerId }: { workerId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const docs = useQuery({
    queryKey: qk.workerDocs(workerId),
    queryFn: () => workersApi.listDocs(workerId),
  });

  const [docType, setDocType] = useState<WorkerDocType>(WorkerDocType.PASSPORT_ID);
  const [reference, setReference] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Signed-URL upload flow (Architecture §7a):
  // 1) request upload-url -> 2) PUT file to Supabase -> 3) confirm -> FileRef row.
  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const signed = await workersApi.requestUpload(workerId, {
        type: docType,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
      });
      const putRes = await fetch(signed.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);
      await workersApi.confirmDoc(workerId, {
        type: docType,
        storageKey: signed.storageKey,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        reference: reference || null,
        expiresAt: expiresAt ? dateInputToISO(expiresAt) : null,
      });
      setFile(null);
      setReference('');
      setExpiresAt('');
      qc.invalidateQueries({ queryKey: qk.workerDocs(workerId) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const removeMut = useMutation({
    mutationFn: (docId: string) => workersApi.removeDoc(workerId, docId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.workerDocs(workerId) }),
  });

  async function openDoc(doc: WorkerDoc) {
    try {
      const { url } = await workersApi.docReadUrl(workerId, doc.id);
      window.open(url, '_blank');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="card">
      <h3 className="subsection-title">{t('workers.docs')}</h3>
      {error ? <div className="banner banner-danger">{error}</div> : null}

      <div className="form-row" style={{ marginBlockEnd: 'var(--sl-space-4)' }}>
        <Field label={t('workers.docType')}>
          <select
            className="select"
            value={docType}
            onChange={(e) => setDocType(e.target.value as WorkerDocType)}
          >
            {Object.values(WorkerDocType).map((d) => (
              <option key={d} value={d}>
                {t(`docType.${d}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('workers.reference')}>
          <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <Field label={t('workers.expiresAt')}>
          <input
            className="input"
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
        </Field>
        <Field label={t('workers.chooseFile')}>
          <input
            className="input"
            type="file"
            accept="image/*,application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </Field>
        <button className="btn btn-primary" disabled={!file || busy} onClick={() => void upload()}>
          {busy ? t('workers.uploading') : t('workers.uploadDoc')}
        </button>
      </div>

      <DataState
        isLoading={docs.isLoading}
        error={docs.error}
        isEmpty={docs.data?.length === 0}
      >
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t('workers.docType')}</th>
                <th>{t('common.date')}</th>
                <th>{t('workers.reference')}</th>
                <th>{t('workers.expiresAt')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {docs.data?.map((doc) => (
                <tr key={doc.id}>
                  <td>{t(`docType.${doc.type}`)}</td>
                  <td>{formatDate(doc.file.uploadedAt)}</td>
                  <td>{doc.reference ?? '—'}</td>
                  <td>{formatDate(doc.expiresAt)}</td>
                  <td>
                    <div className="row-actions">
                      <button className="btn btn-sm" onClick={() => void openDoc(doc)}>
                        {t('workers.openDoc')}
                      </button>
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => removeMut.mutate(doc.id)}
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
    </div>
  );
}
