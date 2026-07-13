/**
 * Users Activity (FR-BO-3). GET /backoffice/users → read-only table with a
 * client-side search box. The payload is BackOfficeUser[] projected to
 * non-sensitive fields (NO authUserId / password by design); "activity" is
 * limited to the derivable columns (lastLoginAt, createdAt) — no event log.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { backOfficeApi, type BackOfficeUser } from '../../lib/api/endpoints';
import { qk } from '../../lib/api/queryKeys';
import { Chip, DataState } from '../../components/ui';
import { formatDateTime } from '../../lib/format';

export function UsersActivityScreen() {
  const { t } = useTranslation();
  const list = useQuery({ queryKey: qk.boUsers, queryFn: () => backOfficeApi.users() });
  const [term, setTerm] = useState('');

  const filtered = useMemo(() => {
    const rows = list.data ?? [];
    const q = term.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((u) =>
      [u.fullName, u.email, u.role].some((v) => v.toLowerCase().includes(q)),
    );
  }, [list.data, term]);

  return (
    <div>
      <div className="page-header">
        <h1 className="section-title" style={{ margin: 0 }}>
          {t('usersActivity.title')}
        </h1>
        <div className="header-spacer" />
        {list.data ? (
          <span className="muted">
            {filtered.length} {t('usersActivity.countLabel')}
          </span>
        ) : null}
      </div>

      <div className="card">
        <div className="field" style={{ maxWidth: 360 }}>
          <input
            className="input"
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={t('usersActivity.searchPlaceholder')}
            aria-label={t('common.search')}
          />
        </div>

        <DataState
          isLoading={list.isLoading}
          error={list.error}
          isEmpty={list.data?.length === 0}
        >
          {filtered.length === 0 ? (
            <div className="empty-state">{t('usersActivity.noMatches')}</div>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('usersActivity.fullName')}</th>
                    <th>{t('usersActivity.email')}</th>
                    <th>{t('usersActivity.role')}</th>
                    <th>{t('usersActivity.accountStatus')}</th>
                    <th>{t('usersActivity.lastLogin')}</th>
                    <th>{t('usersActivity.createdAt')}</th>
                    <th>{t('usersActivity.id')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((u) => (
                    <UserRow key={u.id} user={u} />
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

function UserRow({ user }: { user: BackOfficeUser }) {
  const { t } = useTranslation();
  const roleKey = `roles.${user.role}`;
  const roleLabel = t(roleKey);
  return (
    <tr>
      <td>{user.fullName}</td>
      <td>{user.email}</td>
      <td>{roleLabel === roleKey ? user.role : roleLabel}</td>
      <td>
        {user.isLockedOut ? (
          <Chip tone="danger">{t('usersActivity.lockedOut')}</Chip>
        ) : (
          <Chip tone="success">{t('usersActivity.active')}</Chip>
        )}
      </td>
      <td>{formatDateTime(user.lastLoginAt)}</td>
      <td>{formatDateTime(user.createdAt)}</td>
      <td className="mono">{user.id.slice(0, 8)}</td>
    </tr>
  );
}
