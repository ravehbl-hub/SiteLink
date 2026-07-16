/**
 * Users Activity (FR-BO-3). GET /backoffice/users → read-only table with a
 * client-side search box. The payload is BackOfficeUser[] projected to
 * non-sensitive fields (NO authUserId / password by design); "activity" is
 * limited to the derivable columns (lastLoginAt, createdAt) — no event log.
 *
 * ROLE FILTER (per product decision): the list is scoped to the business/office
 * roles {ADMIN, MANAGER, PARTNER}. A segmented control lets the operator narrow
 * to one of them, or view all three. The PARTNER role is surfaced as the "חברה"
 * (Company) entry — see the "חברה"→PARTNER interpretation note in the handoff.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Role } from '@sitelink/shared';
import { backOfficeApi, type BackOfficeUser } from '../../lib/api/endpoints';
import { qk } from '../../lib/api/queryKeys';
import { Chip, DataState } from '../../components/ui';
import { formatDateTime } from '../../lib/format';

/** The business/office roles this screen reports on. PARTNER == "חברה" (Company). */
const BUSINESS_ROLES = [Role.ADMIN, Role.MANAGER, Role.PARTNER] as const;
type RoleFilter = 'ALL' | Role.ADMIN | Role.MANAGER | Role.PARTNER;

/** i18n key for a role label; PARTNER is shown as "חברה"/Company/Şirket. */
function roleLabelKey(role: string): string {
  return role === Role.PARTNER ? 'roles.PARTNER_COMPANY' : `roles.${role}`;
}

export function UsersActivityScreen() {
  const { t } = useTranslation();
  const list = useQuery({ queryKey: qk.boUsers, queryFn: () => backOfficeApi.users() });
  const [term, setTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('ALL');

  // Restrict to the business/office roles, then apply the segmented filter + search.
  const businessRows = useMemo(
    () =>
      (list.data ?? []).filter((u) =>
        (BUSINESS_ROLES as readonly string[]).includes(u.role),
      ),
    [list.data],
  );

  const filtered = useMemo(() => {
    const byRole =
      roleFilter === 'ALL'
        ? businessRows
        : businessRows.filter((u) => u.role === roleFilter);
    const q = term.trim().toLowerCase();
    if (!q) return byRole;
    return byRole.filter((u) =>
      [u.fullName, u.email, u.role].some((v) => v.toLowerCase().includes(q)),
    );
  }, [businessRows, roleFilter, term]);

  const segments: { key: RoleFilter; labelKey: string }[] = [
    { key: 'ALL', labelKey: 'common.all' },
    { key: Role.ADMIN, labelKey: 'roles.ADMIN' },
    { key: Role.MANAGER, labelKey: 'roles.MANAGER' },
    { key: Role.PARTNER, labelKey: 'roles.PARTNER_COMPANY' },
  ];

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
        <div className="inline" style={{ marginBlockEnd: 'var(--sl-space-4)' }}>
          <div
            className="segmented"
            role="group"
            aria-label={t('usersActivity.roleFilterLabel')}
          >
            {segments.map((s) => (
              <button
                key={s.key}
                type="button"
                className={roleFilter === s.key ? 'seg active' : 'seg'}
                aria-pressed={roleFilter === s.key}
                onClick={() => setRoleFilter(s.key)}
              >
                {t(s.labelKey)}
              </button>
            ))}
          </div>
          <div className="header-spacer" />
          <div className="field" style={{ maxWidth: 360, marginBlockEnd: 0 }}>
            <input
              className="input"
              type="search"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder={t('usersActivity.searchPlaceholder')}
              aria-label={t('common.search')}
            />
          </div>
        </div>

        <DataState
          isLoading={list.isLoading}
          error={list.error}
          isEmpty={businessRows.length === 0}
        >
          {filtered.length === 0 ? (
            <div className="empty-state">{t('usersActivity.noMatches')}</div>
          ) : (
            <div className="table-wrap">
              <table className="data data-compact">
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
  const roleKey = roleLabelKey(user.role);
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
