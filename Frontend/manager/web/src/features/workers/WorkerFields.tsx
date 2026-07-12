/** Worker Details fields (FR-MGR-EMP-2) — reused by the wizard + detail edit. */
import { Profession, WorkerLevel } from '@sitelink/shared';
import { useTranslation } from 'react-i18next';
import { useSitesList } from '../../lib/api/hooks';
import { Field } from '../../components/ui';

export interface WorkerFormState {
  firstName: string;
  lastName: string;
  country: string;
  address: string;
  profession: Profession;
  level: WorkerLevel;
  qualityOfWorks: string;
  phone: string;
  email: string;
  personnelCompany: string;
  residence: string;
  startDate: string; // YYYY-MM-DD
  siteIds: string[];
}

export const emptyWorkerForm: WorkerFormState = {
  firstName: '',
  lastName: '',
  country: '',
  address: '',
  profession: Profession.GENERAL_LABORER,
  level: WorkerLevel.MEDIUM,
  qualityOfWorks: '',
  phone: '',
  email: '',
  personnelCompany: '',
  residence: '',
  startDate: '',
  siteIds: [],
};

export interface WorkerFieldErrors {
  firstName?: string;
  lastName?: string;
  profession?: string;
}

export function validateWorker(form: WorkerFormState, required: string): WorkerFieldErrors {
  const errors: WorkerFieldErrors = {};
  if (!form.firstName.trim()) errors.firstName = required;
  if (!form.lastName.trim()) errors.lastName = required;
  if (!form.profession) errors.profession = required;
  return errors;
}

export function WorkerFields({
  form,
  set,
  errors,
}: {
  form: WorkerFormState;
  set: (patch: Partial<WorkerFormState>) => void;
  errors: WorkerFieldErrors;
}) {
  const { t } = useTranslation();
  const sites = useSitesList();

  return (
    <div className="form-grid">
      <Field label={`${t('workers.firstName')} *`} error={errors.firstName}>
        <input
          className="input"
          value={form.firstName}
          onChange={(e) => set({ firstName: e.target.value })}
        />
      </Field>
      <Field label={`${t('workers.lastName')} *`} error={errors.lastName}>
        <input
          className="input"
          value={form.lastName}
          onChange={(e) => set({ lastName: e.target.value })}
        />
      </Field>
      <Field label={`${t('workers.profession')} *`} error={errors.profession}>
        <select
          className="select"
          value={form.profession}
          onChange={(e) => set({ profession: e.target.value as Profession })}
        >
          {Object.values(Profession).map((p) => (
            <option key={p} value={p}>
              {t(`profession.${p}`)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('workers.level')}>
        <select
          className="select"
          value={form.level}
          onChange={(e) => set({ level: e.target.value as WorkerLevel })}
        >
          {Object.values(WorkerLevel).map((l) => (
            <option key={l} value={l}>
              {t(`level.${l}`)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('workers.country')}>
        <input className="input" value={form.country} onChange={(e) => set({ country: e.target.value })} />
      </Field>
      <Field label={t('workers.address')}>
        <input className="input" value={form.address} onChange={(e) => set({ address: e.target.value })} />
      </Field>
      <Field label={t('workers.phone')}>
        <input className="input" value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
      </Field>
      <Field label={t('workers.email')}>
        <input
          className="input"
          type="email"
          value={form.email}
          onChange={(e) => set({ email: e.target.value })}
        />
      </Field>
      <Field label={t('workers.personnelCompany')}>
        <input
          className="input"
          value={form.personnelCompany}
          onChange={(e) => set({ personnelCompany: e.target.value })}
        />
      </Field>
      <Field label={t('workers.residence')}>
        <input
          className="input"
          value={form.residence}
          onChange={(e) => set({ residence: e.target.value })}
        />
      </Field>
      <Field label={t('workers.startDate')}>
        <input
          className="input"
          type="date"
          value={form.startDate}
          onChange={(e) => set({ startDate: e.target.value })}
        />
      </Field>
      <Field label={t('workers.sites')}>
        <select
          className="select"
          multiple
          value={form.siteIds}
          onChange={(e) =>
            set({ siteIds: Array.from(e.target.selectedOptions).map((o) => o.value) })
          }
          style={{ height: 'auto', minHeight: 80 }}
        >
          {sites.data?.items.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      <div style={{ gridColumn: '1 / -1' }}>
        <Field label={t('workers.qualityOfWorks')}>
          <textarea
            className="textarea"
            value={form.qualityOfWorks}
            onChange={(e) => set({ qualityOfWorks: e.target.value })}
          />
        </Field>
      </div>
    </div>
  );
}
