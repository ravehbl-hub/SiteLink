/** Users Manager (FR-MGR-USER): list + Add User (role/name/site/email/optional
 *  password), Edit, Lockout (reversible), Remove. */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Role, type CreateUserInput, type User } from '@sitelink/shared';
import { usersApi, foremanAssignmentsApi } from '../../lib/api/endpoints';
import { ApiError } from '../../lib/api/client';
import { qk } from '../../lib/api/queryKeys';
import { useSitesList } from '../../lib/api/hooks';
import { useAuth } from '../../app/AuthProvider';
import { DataState, Modal, Field, Chip } from '../../components/ui';

/**
 * UI mirror of the backend's manageableRolesFor (backend/src/plugins/auth.ts).
 * ADMIN → all five roles; MANAGER → {FOREMAN, WORKER, MANAGER} (NO ADMIN/PARTNER).
 * Defense-in-depth + UX only — the server remains the authorization boundary.
 */
function manageableRolesFor(callerRole: Role | undefined): Role[] {
  if (callerRole === Role.ADMIN) {
    return [Role.ADMIN, Role.MANAGER, Role.PARTNER, Role.FOREMAN, Role.WORKER];
  }
  // MANAGER (or unknown — fail closed to the narrower Manager set).
  return [Role.FOREMAN, Role.WORKER, Role.MANAGER];
}

export function UsersScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const params = { page: 1, pageSize: 100 };
  const list = useQuery({ queryKey: qk.users(params), queryFn: () => usersApi.list(params) });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['users'] });
  const lockMut = useMutation({
    mutationFn: (v: { id: string; locked: boolean }) => usersApi.lockout(v.id, v.locked),
    onSuccess: invalidate,
  });
  const removeMut = useMutation({
    mutationFn: (id: string) => usersApi.remove(id),
    onSuccess: invalidate,
  });

  return (
    <div>
      <div className="page-header">
        <h1 className="section-title" style={{ margin: 0 }}>
          {t('users.title')}
        </h1>
        <div className="header-spacer" />
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          {t('users.newUser')}
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
                  <th>{t('users.fullName')}</th>
                  <th>{t('auth.email')}</th>
                  <th>{t('users.role')}</th>
                  <th>{t('common.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.data?.items.map((u) => (
                  <tr key={u.id}>
                    <td>{u.fullName}</td>
                    <td>{u.email}</td>
                    <td>{t(`roles.${u.role}`)}</td>
                    <td>
                      {u.isLockedOut ? (
                        <Chip tone="danger">{t('users.lockedOut')}</Chip>
                      ) : (
                        <Chip tone="success">{t('workers.active')}</Chip>
                      )}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button className="btn btn-sm" onClick={() => setEditing(u)}>
                          {t('common.edit')}
                        </button>
                        <button
                          className="btn btn-sm"
                          onClick={() => lockMut.mutate({ id: u.id, locked: !u.isLockedOut })}
                        >
                          {u.isLockedOut ? t('users.unlock') : t('users.lockout')}
                        </button>
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => {
                            if (confirm(t('users.confirmDelete'))) removeMut.mutate(u.id);
                          }}
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

      {creating ? <UserForm onClose={() => setCreating(false)} /> : null}
      {editing ? <UserForm user={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function UserForm({ user, onClose }: { user?: User; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const sites = useSitesList();
  const { user: currentUser } = useAuth();
  const roleOptions = manageableRolesFor(currentUser?.role);
  // Edit edge case: if an existing user's role is outside the caller's allowed
  // set (a Manager normally can't even reach such a user — backend 403s), keep
  // it visible so we never render an empty/mismatched combobox or crash.
  const options =
    user && !roleOptions.includes(user.role) ? [user.role, ...roleOptions] : roleOptions;
  const [role, setRole] = useState<Role>(user?.role ?? roleOptions[0] ?? Role.FOREMAN);
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [primarySiteId, setPrimarySiteId] = useState(user?.primarySiteId ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const isForeman = role === Role.FOREMAN;

  // EDIT + FOREMAN: load the target's CURRENT additional-site scope (active
  // ForemanSiteAssignment rows). primarySiteId is the default and is NOT part of
  // this set. Only enabled when editing a user who is already a foreman.
  const editingForeman = Boolean(user) && user?.role === Role.FOREMAN;
  const assignments = useQuery({
    queryKey: qk.foremanAssignments(user?.id ?? ''),
    queryFn: () => foremanAssignmentsApi.list(user!.id),
    enabled: editingForeman,
    staleTime: 0,
  });

  // Selected additional sites (site ids). Seeded from the loaded assignments on
  // edit; empty on add. `seeded` guards the one-shot preselect so user toggles
  // aren't clobbered by a background refetch.
  const [additionalSiteIds, setAdditionalSiteIds] = useState<string[]>([]);
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (!seeded && assignments.data) {
      setAdditionalSiteIds(assignments.data.map((a) => a.siteId));
      setSeeded(true);
    }
  }, [assignments.data, seeded]);

  const toggleAdditional = (siteId: string) =>
    setAdditionalSiteIds((prev) =>
      prev.includes(siteId) ? prev.filter((s) => s !== siteId) : [...prev, siteId],
    );

  // Apply the additional-sites diff for a foreman (id known post-create on add).
  // POST newly-selected, DELETE removed. Primary is never assigned here. Errors
  // surface (thrown) so the mutation reports them instead of silently vanishing.
  const applyAssignments = async (foremanId: string) => {
    const current = new Set(assignments.data?.map((a) => a.siteId) ?? []);
    const desired = new Set(additionalSiteIds.filter((s) => s && s !== primarySiteId));
    const toAdd = [...desired].filter((s) => !current.has(s));
    const toRemove = [...current].filter((s) => !desired.has(s));
    await Promise.all([
      ...toAdd.map((siteId) => foremanAssignmentsApi.assign(foremanId, siteId)),
      ...toRemove.map((siteId) => foremanAssignmentsApi.unassign(foremanId, siteId)),
    ]);
    if (toAdd.length || toRemove.length) {
      qc.invalidateQueries({ queryKey: qk.foremanAssignments(foremanId) });
    }
  };

  const mut = useMutation({
    mutationFn: async () => {
      if (user) {
        const updated = await usersApi.update(user.id, {
          fullName,
          email,
          role,
          primarySiteId: primarySiteId || null,
        });
        if (isForeman) await applyAssignments(user.id);
        return updated;
      }
      const body: CreateUserInput = {
        role,
        fullName,
        email,
        primarySiteId: primarySiteId || null,
        ...(password ? { password } : {}),
      };
      const created = await usersApi.create(body);
      if (isForeman) await applyAssignments(created.id);
      return created;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: (e) =>
      setError(
        e instanceof ApiError && e.code === 'USER_EMAIL_EXISTS'
          ? t('users.emailExists')
          : e instanceof Error
            ? e.message
            : String(e),
      ),
  });

  return (
    <Modal
      title={user ? t('common.edit') : t('users.newUser')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            className="btn btn-primary"
            disabled={!fullName || !email || mut.isPending}
            onClick={() => mut.mutate()}
          >
            {t('common.save')}
          </button>
        </>
      }
    >
      {error ? <div className="banner banner-danger">{error}</div> : null}
      <Field label={t('users.role')}>
        <select className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {options.map((r) => (
            <option key={r} value={r}>
              {t(`roles.${r}`)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('users.fullName')}>
        <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </Field>
      <Field label={t('auth.email')}>
        <input
          className="input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field label={t('users.primarySite')}>
        <select
          className="select"
          value={primarySiteId ?? ''}
          onChange={(e) => setPrimarySiteId(e.target.value)}
        >
          <option value="">{t('common.none')}</option>
          {sites.data?.items.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      {isForeman ? (
        <Field label={t('users.additionalSites')}>
          <span className="muted">{t('users.additionalSitesHint')}</span>
          {editingForeman && assignments.isLoading ? (
            <div className="checklist-empty">{t('common.loading')}</div>
          ) : (
            (() => {
              const others = (sites.data?.items ?? []).filter((s) => s.id !== primarySiteId);
              if (others.length === 0) {
                return <div className="checklist-empty">{t('users.noOtherSites')}</div>;
              }
              return (
                <div className="checklist">
                  {others.map((s) => (
                    <label key={s.id} className="checklist-item">
                      <input
                        type="checkbox"
                        checked={additionalSiteIds.includes(s.id)}
                        onChange={() => toggleAdditional(s.id)}
                      />
                      {s.name}
                    </label>
                  ))}
                </div>
              );
            })()
          )}
        </Field>
      ) : null}
      {!user ? (
        <Field label={`${t('users.password')} (${t('common.optional')})`}>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <span className="muted">{t('users.passwordHint')}</span>
        </Field>
      ) : null}
    </Modal>
  );
}
