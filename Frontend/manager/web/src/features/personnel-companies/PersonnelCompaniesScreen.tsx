/**
 * Personnel Companies management (FR-MGR-EMP-2).
 *
 * Org-wide staffing companies managed by ADMIN/MANAGER. List + Add/Edit modal +
 * Archive/Unarchive + includeArchived toggle. Duplicate name (409) surfaces a
 * friendly inline error in the form. Operations Deck styling, compact controls,
 * RTL-safe (logical properties in styles.css; no hard-coded left/right here).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CreatePersonnelCompanyInput, PersonnelCompany } from '@sitelink/shared';
import { ApiError } from '../../lib/api/client';
import { DataState, Modal, Field, Chip } from '../../components/ui';
import {
  useArchivePersonnelCompany,
  useCreatePersonnelCompany,
  useDeletePersonnelCompany,
  usePersonnelCompaniesList,
  useUpdatePersonnelCompany,
} from './hooks';

export function PersonnelCompaniesScreen() {
  const { t } = useTranslation();
  const [includeArchived, setIncludeArchived] = useState(false);
  const list = usePersonnelCompaniesList(includeArchived);
  const [editing, setEditing] = useState<PersonnelCompany | null>(null);
  const [creating, setCreating] = useState(false);

  const archiveMut = useArchivePersonnelCompany();
  const deleteMut = useDeletePersonnelCompany();
  const [removeError, setRemoveError] = useState<string | null>(null);

  const remove = (c: PersonnelCompany) => {
    if (!window.confirm(t('personnelCompanies.confirmRemove'))) return;
    setRemoveError(null);
    deleteMut.mutate(c.id, {
      onError: (e) => setRemoveError(e instanceof Error ? e.message : String(e)),
    });
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="section-title" style={{ margin: 0 }}>
          {t('personnelCompanies.title')}
        </h1>
        <div className="header-spacer" />
        <label className="inline">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          {t('personnelCompanies.showArchived')}
        </label>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          {t('personnelCompanies.newCompany')}
        </button>
      </div>

      <div className="card">
        {removeError ? (
          <div className="banner banner-danger">{removeError}</div>
        ) : null}
        <DataState
          isLoading={list.isLoading}
          error={list.error}
          isEmpty={list.data?.items.length === 0}
        >
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('personnelCompanies.name')}</th>
                  <th>{t('personnelCompanies.contactName')}</th>
                  <th>{t('personnelCompanies.phone')}</th>
                  <th>{t('personnelCompanies.email')}</th>
                  <th>{t('common.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.data?.items.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td>{c.contactName ?? '—'}</td>
                    <td>{c.phone ?? '—'}</td>
                    <td>{c.email ?? '—'}</td>
                    <td>
                      {c.isArchived ? (
                        <Chip tone="neutral">{t('personnelCompanies.archived')}</Chip>
                      ) : (
                        <Chip tone="success">{t('personnelCompanies.active')}</Chip>
                      )}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button className="btn btn-sm" onClick={() => setEditing(c)}>
                          {t('common.edit')}
                        </button>
                        <button
                          className="btn btn-sm"
                          disabled={archiveMut.isPending}
                          onClick={() =>
                            archiveMut.mutate({ id: c.id, isArchived: c.isArchived })
                          }
                        >
                          {c.isArchived
                            ? t('personnelCompanies.unarchive')
                            : t('common.archive')}
                        </button>
                        <button
                          className="btn btn-sm btn-danger"
                          disabled={deleteMut.isPending}
                          onClick={() => remove(c)}
                        >
                          {t('personnelCompanies.remove')}
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

      {creating ? <CompanyForm onClose={() => setCreating(false)} /> : null}
      {editing ? (
        <CompanyForm company={editing} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}

function CompanyForm({
  company,
  onClose,
}: {
  company?: PersonnelCompany;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const createMut = useCreatePersonnelCompany();
  const updateMut = useUpdatePersonnelCompany();
  const [name, setName] = useState(company?.name ?? '');
  const [contactName, setContactName] = useState(company?.contactName ?? '');
  const [phone, setPhone] = useState(company?.phone ?? '');
  const [email, setEmail] = useState(company?.email ?? '');
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  const pending = createMut.isPending || updateMut.isPending;

  const onError = (e: unknown) => {
    // 409 → duplicate name: friendly inline error on the name field.
    if (e instanceof ApiError && e.status === 409) {
      setNameError(t('personnelCompanies.nameExists'));
      return;
    }
    setError(e instanceof Error ? e.message : String(e));
  };

  const submit = () => {
    setError(null);
    setNameError(null);
    const body: CreatePersonnelCompanyInput = {
      name: name.trim(),
      contactName: contactName.trim() || null,
      phone: phone.trim() || null,
      email: email.trim() || null,
    };
    if (company) {
      updateMut.mutate(
        { id: company.id, body },
        { onSuccess: onClose, onError },
      );
    } else {
      createMut.mutate(body, { onSuccess: onClose, onError });
    }
  };

  return (
    <Modal
      title={company ? t('common.edit') : t('personnelCompanies.newCompany')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            className="btn btn-primary"
            disabled={!name.trim() || pending}
            onClick={submit}
          >
            {t('common.save')}
          </button>
        </>
      }
    >
      {error ? <div className="banner banner-danger">{error}</div> : null}
      <Field label={t('personnelCompanies.name')} error={nameError ?? undefined}>
        <input
          className="input"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (nameError) setNameError(null);
          }}
        />
      </Field>
      <Field label={t('personnelCompanies.contactName')}>
        <input
          className="input"
          value={contactName}
          onChange={(e) => setContactName(e.target.value)}
        />
      </Field>
      <Field label={t('personnelCompanies.phone')}>
        <input
          className="input"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </Field>
      <Field label={t('personnelCompanies.email')}>
        <input
          className="input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
    </Modal>
  );
}
