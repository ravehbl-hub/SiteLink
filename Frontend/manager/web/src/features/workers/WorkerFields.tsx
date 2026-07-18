/** Worker Details fields (FR-MGR-EMP-2) — reused by the wizard + detail edit. */
import { useState } from 'react';
import { Profession, WorkerLevel } from '@sitelink/shared';
import { useTranslation } from 'react-i18next';
import { useSitesList } from '../../lib/api/hooks';
import { usePersonnelCompaniesList } from '../personnel-companies/hooks';
import { Field } from '../../components/ui';

/** Minimum initial-password length — mirrors the back end (Supabase policy min 8). */
export const MIN_PASSWORD_LENGTH = 8;

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
  password: string;
  /** FK to the selected PersonnelCompany (picker). Empty string = none. */
  personnelCompanyId: string;
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
  password: '',
  personnelCompanyId: '',
  residence: '',
  startDate: '',
  siteIds: [],
};

export interface WorkerFieldErrors {
  firstName?: string;
  lastName?: string;
  profession?: string;
  email?: string;
  password?: string;
}

/** Basic RFC-lite email shape check for the required worker login email. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate the worker form.
 * `requireEmail` is true on CREATE (item 12: every new worker gets a WORKER login
 * provisioned from this email). On EDIT the field is optional — legacy login-less
 * workers may still have an empty email — but if present it must be well-formed.
 * `requirePassword` is true on CREATE only (min 8); on EDIT the password field is
 * OMITTED entirely (the PATCH path never resets the Supabase auth password).
 */
export function validateWorker(
  form: WorkerFormState,
  required: string,
  messages?: {
    requireEmail?: boolean;
    emailRequired?: string;
    emailInvalid?: string;
    requirePassword?: boolean;
    passwordRequired?: string;
    passwordTooShort?: string;
  },
): WorkerFieldErrors {
  const errors: WorkerFieldErrors = {};
  if (!form.firstName.trim()) errors.firstName = required;
  if (!form.lastName.trim()) errors.lastName = required;
  if (!form.profession) errors.profession = required;
  const email = form.email.trim();
  if (!email) {
    if (messages?.requireEmail) errors.email = messages.emailRequired ?? required;
  } else if (!EMAIL_RE.test(email)) {
    errors.email = messages?.emailInvalid ?? required;
  }
  if (messages?.requirePassword) {
    if (!form.password) {
      errors.password = messages.passwordRequired ?? required;
    } else if (form.password.length < MIN_PASSWORD_LENGTH) {
      errors.password = messages.passwordTooShort ?? required;
    }
  }
  return errors;
}

export function WorkerFields({
  form,
  set,
  errors,
  mode = 'edit',
}: {
  form: WorkerFormState;
  set: (patch: Partial<WorkerFormState>) => void;
  errors: WorkerFieldErrors;
  /** 'create' shows the login provisioning fields (required email, optional
   *  password, static Role: Worker). 'edit' shows email as an optional update. */
  mode?: 'create' | 'edit';
}) {
  const { t } = useTranslation();
  const sites = useSitesList();
  // Picker source: ACTIVE companies only (archived excluded → includeArchived=false).
  const companies = usePersonnelCompaniesList(false);
  const companyItems = companies.data?.items ?? [];
  const noCompanies = !companies.isLoading && companyItems.length === 0;
  const isCreate = mode === 'create';
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="form-grid">
      {/* FIELD ORDER (item 12): email (required) → first password (create-only,
          required min 8) → then the rest. Login-provisioning fields lead the form. */}
      <Field
        label={isCreate ? `${t('workers.email')} *` : t('workers.email')}
        error={errors.email}
      >
        <input
          className="input"
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={(e) => set({ email: e.target.value })}
        />
      </Field>
      {isCreate ? (
        <>
          <Field label={`${t('workers.firstPassword')} *`} error={errors.password}>
            <div className="input-with-affix" style={{ display: 'flex', gap: 'var(--sl-space-2, 8px)' }}>
              <input
                className="input"
                style={{ flex: 1 }}
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                placeholder={t('workers.passwordMinHint')}
                value={form.password}
                onChange={(e) => set({ password: e.target.value })}
              />
              <button
                type="button"
                className="btn btn-sm"
                aria-pressed={showPassword}
                onClick={() => setShowPassword((s) => !s)}
              >
                {showPassword ? t('workers.hidePassword') : t('workers.showPassword')}
              </button>
            </div>
            {!errors.password ? (
              <span className="muted" style={{ fontSize: '0.85em' }}>{t('workers.passwordMinHint')}</span>
            ) : null}
          </Field>
          <Field label={t('workers.role')}>
            <div className="input" aria-readonly="true" style={{ display: 'flex', alignItems: 'center' }}>
              {t('workers.roleWorker')}
            </div>
          </Field>
        </>
      ) : null}
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
      {/* Personnel company PICKER (replaces the legacy free-text input). Stores the
          FK id; empty option = none. Hint shown when no active company exists yet. */}
      <Field label={t('workers.personnelCompany')}>
        <select
          className="select"
          value={form.personnelCompanyId}
          disabled={noCompanies}
          onChange={(e) => set({ personnelCompanyId: e.target.value })}
        >
          <option value="">{t('workers.personnelCompanyNone')}</option>
          {companyItems.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {noCompanies ? (
          <span className="muted" style={{ fontSize: '0.85em' }}>
            {t('workers.personnelCompanyEmptyHint')}
          </span>
        ) : null}
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
