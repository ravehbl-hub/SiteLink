/** Worker list (FR-MGR-EMP-5/6): active + archives toggle, per-site filter,
 *  archive/remove, link to details, and a launcher for the Worker Wizard. */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { workersApi } from '../../lib/api/endpoints';
import { qk } from '../../lib/api/queryKeys';
import { useSitesList } from '../../lib/api/hooks';
import { DataState, Chip } from '../../components/ui';

export function WorkersList() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const sites = useSitesList();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [siteId, setSiteId] = useState('');

  const params = { includeArchived, siteId: siteId || undefined, pageSize: 200 };
  const list = useQuery({ queryKey: qk.workers(params), queryFn: () => workersApi.list(params) });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['workers'] });
  const archiveMut = useMutation({
    mutationFn: (id: string) => workersApi.archive(id),
    onSuccess: invalidate,
  });
  const removeMut = useMutation({
    mutationFn: (id: string) => workersApi.remove(id),
    onSuccess: invalidate,
  });

  return (
    <div>
      <div className="page-header">
        <h1 className="section-title" style={{ margin: 0 }}>
          {t('workers.title')}
        </h1>
        <div className="header-spacer" />
        <select
          className="select"
          style={{ width: 'auto' }}
          value={siteId}
          onChange={(e) => setSiteId(e.target.value)}
        >
          <option value="">{t('common.allSites')}</option>
          {sites.data?.items.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <label className="inline">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          {t('workers.showArchived')}
        </label>
        <button className="btn btn-primary" onClick={() => navigate('/workers/new')}>
          {t('workers.newWorker')}
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
                  <th>{t('workers.firstName')}</th>
                  <th>{t('workers.lastName')}</th>
                  <th>{t('workers.profession')}</th>
                  <th>{t('workers.level')}</th>
                  <th>{t('common.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.data?.items.map((w) => (
                  <tr key={w.id}>
                    <td>
                      <Link to={`/workers/${w.id}`}>{w.firstName}</Link>
                    </td>
                    <td>{w.lastName}</td>
                    <td>{t(`profession.${w.profession}`)}</td>
                    <td>{t(`level.${w.level}`)}</td>
                    <td>
                      {w.isArchived ? (
                        <Chip tone="neutral">{t('workers.archived')}</Chip>
                      ) : (
                        <Chip tone="success">{t('workers.active')}</Chip>
                      )}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button className="btn btn-sm" onClick={() => navigate(`/workers/${w.id}`)}>
                          {t('common.view')}
                        </button>
                        {!w.isArchived ? (
                          <button
                            className="btn btn-sm"
                            onClick={() => {
                              if (confirm(t('workers.confirmArchive'))) archiveMut.mutate(w.id);
                            }}
                          >
                            {t('common.archive')}
                          </button>
                        ) : null}
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => {
                            if (confirm(t('workers.confirmDelete'))) removeMut.mutate(w.id);
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
    </div>
  );
}
