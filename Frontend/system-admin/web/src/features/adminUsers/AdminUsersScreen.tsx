/**
 * Admin Users management (System Admin surface, ADMIN-only).
 *
 * Lists + CRUDs the ADMIN-role users via the Manager/Admin-gated /users routes.
 * The list is scoped with `?role=ADMIN` (an ADMIN caller may manage any role,
 * incl. ADMIN). GET /users returns a Paginated<User> envelope — we consume
 * `.items`, never the bare response (PAGINATION: {items,...}, not an array).
 *
 * Mirrors the Manager web UsersScreen: modal form for create/edit, reversible
 * lockout, delete, and the friendly USER_EMAIL_EXISTS mapping via ApiError.code.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Role, type CreateUserInput, type User } from '@sitelink/shared';
import { usersApi, type ListUsersParams } from '../../lib/api/endpoints';
import { ApiError } from '../../lib/api/client';
import { qk } from '../../lib/api/queryKeys';
import { Chip, DataState, Field, Modal } from '../../components/ui';
import { formatDateTime } from '../../lib/format';

const LIST_PARAMS: ListUsersParams = { role: Role.ADMIN, page: 1, pageSize: 100 };

export function AdminUsersScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: qk.users(LIST_PARAMS),
    queryFn: () => usersApi.list(LIST_PARAMS),
  });
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

  // Consume the Paginated envelope: `.items`, never a bare array.
  const items = list.data?.items ?? [];

  return (
    <div>
      <div className="page-header">
        <h1 className="section-title" style={{ margin: 0 }}>
          {t('adminUsers.title')}
        </h1>
        <div className="header-spacer" />
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          {t('adminUsers.newAdmin')}
        </button>
      </div>

      <div className="card">
        <DataState isLoading={list.isLoading} error={list.error} isEmpty={items.length === 0}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('adminUsers.fullName')}</th>
                  <th>{t('adminUsers.email')}</th>
                  <th>{t('adminUsers.role')}</th>
                  <th>{t('adminUsers.accountStatus')}</th>
                  <th>{t('adminUsers.lastLogin')}</th>
                  <th>{t('adminUsers.createdAt')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((u) => (
                  <tr key={u.id}>
                    <td>{u.fullName}</td>
                    <td>{u.email}</td>
                    <td>{t(`roles.${u.role}`)}</td>
                    <td>
                      {u.isLockedOut ? (
                        <Chip tone="danger">{t('adminUsers.lockedOut')}</Chip>
                      ) : (
                        <Chip tone="success">{t('adminUsers.active')}</Chip>
                      )}
                    </td>
                    <td>{formatDateTime(u.lastLoginAt)}</td>
                    <td>{formatDateTime(u.createdAt)}</td>
                    <td>
                      <div className="row-actions">
                        <button className="btn btn-sm" onClick={() => setEditing(u)}>
                          {t('adminUsers.edit')}
                        </button>
                        <button
                          className="btn btn-sm"
                          onClick={() => lockMut.mutate({ id: u.id, locked: !u.isLockedOut })}
                        >
                          {u.isLockedOut ? t('adminUsers.unlock') : t('adminUsers.lockout')}
                        </button>
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => {
                            if (confirm(t('adminUsers.confirmDelete'))) removeMut.mutate(u.id);
                          }}
                        >
                          {t('adminUsers.remove')}
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

      {creating ? <AdminUserForm onClose={() => setCreating(false)} /> : null}
      {editing ? <AdminUserForm user={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function AdminUserForm({ user, onClose }: { user?: User; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: async () => {
      if (user) {
        return usersApi.update(user.id, { fullName, email });
      }
      const body: CreateUserInput = {
        role: Role.ADMIN,
        fullName,
        email,
        ...(password ? { password } : {}),
      };
      return usersApi.create(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: (e) =>
      setError(
        e instanceof ApiError && e.code === 'USER_EMAIL_EXISTS'
          ? t('adminUsers.emailExists')
          : e instanceof Error
            ? e.message
            : String(e),
      ),
  });

  return (
    <Modal
      title={user ? t('adminUsers.edit') : t('adminUsers.newAdmin')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('adminUsers.cancel')}
          </button>
          <button
            className="btn btn-primary"
            disabled={!fullName || !email || mut.isPending}
            onClick={() => mut.mutate()}
          >
            {t('adminUsers.save')}
          </button>
        </>
      }
    >
      {error ? <div className="banner banner-danger">{error}</div> : null}
      <Field label={t('adminUsers.fullName')}>
        <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </Field>
      <Field label={t('adminUsers.email')}>
        <input
          className="input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      {!user ? (
        <Field label={`${t('adminUsers.password')} (${t('adminUsers.optional')})`}>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <span className="muted">{t('adminUsers.passwordHint')}</span>
        </Field>
      ) : null}
    </Modal>
  );
}
