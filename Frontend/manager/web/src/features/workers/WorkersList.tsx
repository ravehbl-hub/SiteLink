/** Worker list (FR-MGR-EMP-5/6): Active ⇄ Archived view switch, per-site filter,
 *  archive/restore/remove, link to details, and a launcher for the Worker Wizard.
 *  Archived view queries GET /workers?archivedOnly=true (ONLY archived rows). */
import { useEffect, useState } from 'react';
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
  // Active ⇄ Archived VIEW switch. false = Active (default GET /workers, no
  // archived); true = Archived (GET /workers?archivedOnly=true — ONLY archived).
  const [archived, setArchived] = useState(false);
  const [siteId, setSiteId] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);

  // Debounce the raw search input (~300ms) so we don't refetch per keystroke.
  useEffect(() => {
    const term = search.trim();
    const h = setTimeout(() => setDebouncedSearch(term), 300);
    return () => clearTimeout(h);
  }, [search]);

  // Reset to page 1 whenever the effective search term changes, so we never
  // land on an out-of-range page for a narrower result set.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const params = {
    // archivedOnly drives the Archived view; server treats it as precedence
    // over includeArchived, so we never send both.
    archivedOnly: archived || undefined,
    siteId: siteId || undefined,
    search: debouncedSearch || undefined,
    page,
    pageSize: 200,
  };
  const list = useQuery({ queryKey: qk.workers(params), queryFn: () => workersApi.list(params) });

  // Invalidate the broad ['workers'] root so BOTH views' cached queries refetch.
  const invalidate = () => qc.invalidateQueries({ queryKey: ['workers'] });
  const archiveMut = useMutation({
    mutationFn: (id: string) => workersApi.archive(id),
    onSuccess: invalidate,
  });
  const unarchiveMut = useMutation({
    mutationFn: (id: string) => workersApi.unarchive(id),
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
        <input
          className="input"
          type="search"
          style={{ width: 'auto' }}
          value={search}
          placeholder={t('workers.searchPlaceholder')}
          onChange={(e) => setSearch(e.target.value)}
        />
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
        <div className="inline" role="group" aria-label={t('workers.showArchived')}>
          <button
            type="button"
            className={`btn btn-sm${archived ? '' : ' btn-primary'}`}
            aria-pressed={!archived}
            onClick={() => {
              if (!archived) return;
              setArchived(false);
              setPage(1);
            }}
          >
            {t('workers.viewActive')}
          </button>
          <button
            type="button"
            className={`btn btn-sm${archived ? ' btn-primary' : ''}`}
            aria-pressed={archived}
            onClick={() => {
              if (archived) return;
              setArchived(true);
              setPage(1);
            }}
          >
            {t('workers.viewArchived')}
          </button>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/workers/new')}>
          {t('workers.newWorker')}
        </button>
      </div>

      <div className="card">
        <DataState
          isLoading={list.isLoading}
          error={list.error}
          isEmpty={!archived && list.data?.items.length === 0}
        >
          {archived && list.data?.items.length === 0 ? (
            <div className="empty-state">{t('workers.noArchived')}</div>
          ) : (
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
                      <div className="row-actions">
                        {w.isArchived ? (
                          <Chip tone="neutral">{t('workers.archived')}</Chip>
                        ) : (
                          <Chip tone="success">{t('workers.active')}</Chip>
                        )}
                        {/* item 12: legacy login-less workers (userId null) flagged. */}
                        {w.userId == null ? (
                          <Chip tone="warning">{t('workers.noLogin')}</Chip>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button className="btn btn-sm" onClick={() => navigate(`/workers/${w.id}`)}>
                          {t('common.view')}
                        </button>
                        {w.isArchived ? (
                          <button
                            className="btn btn-sm"
                            onClick={() => {
                              if (confirm(t('workers.confirmRestore'))) unarchiveMut.mutate(w.id);
                            }}
                          >
                            {t('workers.restore')}
                          </button>
                        ) : (
                          <button
                            className="btn btn-sm"
                            onClick={() => {
                              if (confirm(t('workers.confirmArchive'))) archiveMut.mutate(w.id);
                            }}
                          >
                            {t('common.archive')}
                          </button>
                        )}
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
          )}
        </DataState>
      </div>
    </div>
  );
}
