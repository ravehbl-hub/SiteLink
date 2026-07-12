/** Construction-site manager (FR-MGR-SITE): list + Add/Modify/Remove/Archive. */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { SiteStatus, type CreateSiteInput, type Site } from '@sitelink/shared';
import { sitesApi } from '../../lib/api/endpoints';
import { useSitesList } from '../../lib/api/hooks';
import { DataState, Modal, Field, Chip } from '../../components/ui';
import { formatDate, toDateInput, dateInputToISO } from '../../lib/format';

export function SitesScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [includeArchived, setIncludeArchived] = useState(false);
  const list = useSitesList(includeArchived);
  const [editing, setEditing] = useState<Site | null>(null);
  const [creating, setCreating] = useState(false);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['sites'] });

  const removeMut = useMutation({
    mutationFn: (id: string) => sitesApi.remove(id),
    onSuccess: invalidate,
  });
  const archiveMut = useMutation({
    mutationFn: (id: string) => sitesApi.archive(id),
    onSuccess: invalidate,
  });

  return (
    <div>
      <div className="page-header">
        <h1 className="section-title" style={{ margin: 0 }}>
          {t('sites.title')}
        </h1>
        <div className="header-spacer" />
        <label className="inline">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          {t('sites.showArchived')}
        </label>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          {t('sites.newSite')}
        </button>
      </div>

      <div className="card">
        <DataState
          isLoading={list.isLoading}
          error={list.error}
          isEmpty={list.data?.items.length === 0}
        >
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('sites.name')}</th>
                  <th>{t('sites.code')}</th>
                  <th>{t('sites.address')}</th>
                  <th>{t('sites.startedAt')}</th>
                  <th>{t('common.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.data?.items.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td>{s.code ?? '—'}</td>
                    <td>{s.address ?? '—'}</td>
                    <td>{formatDate(s.startedAt)}</td>
                    <td>
                      <Chip tone={s.status === SiteStatus.ACTIVE ? 'success' : 'neutral'}>
                        {t(`siteStatus.${s.status}`)}
                      </Chip>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button className="btn btn-sm" onClick={() => setEditing(s)}>
                          {t('common.edit')}
                        </button>
                        {s.status === SiteStatus.ACTIVE ? (
                          <button
                            className="btn btn-sm"
                            onClick={() => {
                              if (confirm(t('sites.confirmArchive'))) archiveMut.mutate(s.id);
                            }}
                          >
                            {t('common.archive')}
                          </button>
                        ) : null}
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => {
                            if (confirm(t('sites.confirmDelete'))) removeMut.mutate(s.id);
                          }}
                        >
                          {t('common.delete')}
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

      {creating ? <SiteForm onClose={() => setCreating(false)} /> : null}
      {editing ? <SiteForm site={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function SiteForm({ site, onClose }: { site?: Site; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState(site?.name ?? '');
  const [code, setCode] = useState(site?.code ?? '');
  const [address, setAddress] = useState(site?.address ?? '');
  const [startedAt, setStartedAt] = useState(toDateInput(site?.startedAt));
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: async () => {
      const body: CreateSiteInput = {
        name,
        code: code || null,
        address: address || null,
        startedAt: startedAt ? dateInputToISO(startedAt) : null,
      };
      if (site) return sitesApi.update(site.id, body);
      return sitesApi.create(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sites'] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  return (
    <Modal
      title={site ? t('common.edit') : t('sites.newSite')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            className="btn btn-primary"
            disabled={!name || mut.isPending}
            onClick={() => mut.mutate()}
          >
            {t('common.save')}
          </button>
        </>
      }
    >
      {error ? <div className="banner banner-danger">{error}</div> : null}
      <Field label={t('sites.name')}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t('sites.code')}>
        <input className="input" value={code ?? ''} onChange={(e) => setCode(e.target.value)} />
      </Field>
      <Field label={t('sites.address')}>
        <input className="input" value={address ?? ''} onChange={(e) => setAddress(e.target.value)} />
      </Field>
      <Field label={t('sites.startedAt')}>
        <input
          className="input"
          type="date"
          value={startedAt}
          onChange={(e) => setStartedAt(e.target.value)}
        />
      </Field>
    </Modal>
  );
}
