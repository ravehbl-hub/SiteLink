/**
 * Users Manager (FR-MGR-USER). List users; add a user (role + name + site + email
 * + optional password → server dual-writes Supabase identity + app User); edit,
 * lockout (reversible), and remove. Credentials are managed by Supabase (no
 * password stored here beyond the optional initial one passed to provisioning).
 *
 * Multi-site FOREMAN scope: a user row carries a single primarySiteId, but a
 * FOREMAN's full authorized scope is primarySiteId + active ForemanSiteAssignment
 * rows (foreman-assignments endpoints, MANAGER/ADMIN gated). This screen exposes an
 * ADDITIONAL SITES multi-select for FOREMAN users only; on save it diffs the picked
 * set against the server's current assignments and POSTs additions / DELETEs
 * removals (after the user create/update succeeds).
 */
import React, { useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Role,
  type CreateUserInput,
  type ForemanSiteAssignment,
  type Site,
  type User,
} from '@sitelink/shared';
import { endpoints } from '../../lib/endpoints';
import { qk } from '../../lib/queryKeys';
import { ApiError } from '../../lib/api';
import { roleOptions, manageableRolesFor } from '../../lib/enumOptions';
import { useAuth } from '../../auth/AuthProvider';
import {
  Body,
  Button,
  Card,
  EmptyState,
  Field,
  Loading,
  MultiSelectChips,
  Row,
  Screen,
  SectionHeading,
  Segmented,
  StatusPill,
  Title,
} from '../../components/ui';

/**
 * Additional-sites options for a FOREMAN: every site EXCEPT the current primary
 * (the primary is always in scope and is locked out of the additional set).
 */
function additionalOptions(
  sites: Site[],
  primarySiteId: string | null,
): { value: string; label: string }[] {
  return sites
    .filter((s) => s.id !== primarySiteId)
    .map((s) => ({ value: s.id, label: s.name }));
}

/**
 * Apply an additional-sites selection for a foreman by diffing `selected` against
 * the foreman's CURRENT active assignment siteIds: POST each added site, DELETE
 * each removed one. The primary site is never assigned here (it lives on the user
 * row). Throws on the first failing call so the caller can surface it — a failed
 * assignment must not silently vanish.
 */
async function applyAdditionalSites(
  foremanId: string,
  selected: string[],
  currentSiteIds: string[],
) {
  const want = new Set(selected);
  const have = new Set(currentSiteIds);
  const toAdd = selected.filter((id) => !have.has(id));
  const toRemove = currentSiteIds.filter((id) => !want.has(id));
  for (const siteId of toAdd) await endpoints.assignForemanSite(foremanId, siteId);
  for (const siteId of toRemove) await endpoints.unassignForemanSite(foremanId, siteId);
}

export function UsersScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user: currentUser } = useAuth();
  const allowedRoles = manageableRolesFor(currentUser?.role);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>(allowedRoles[0] ?? Role.FOREMAN);
  const [primarySiteId, setPrimarySiteId] = useState<string | null>(null);
  const [additionalSiteIds, setAdditionalSiteIds] = useState<string[]>([]);

  const usersQ = useQuery({ queryKey: qk.users, queryFn: () => endpoints.listUsers() });
  const sitesQ = useQuery({ queryKey: qk.sites(false), queryFn: () => endpoints.listSites(false) });
  const sites = (sitesQ.data?.items ?? []) as Site[];

  const addMut = useMutation({
    mutationFn: async () => {
      const body: CreateUserInput = {
        role,
        fullName: fullName.trim(),
        email: email.trim(),
        primarySiteId,
      };
      if (password.trim()) body.password = password.trim();
      const created = await endpoints.createUser(body);
      // Only a FOREMAN carries a multi-site scope; for any other role we send no
      // assignments. New user has no current assignments → all picks are POSTs.
      if (role === Role.FOREMAN && additionalSiteIds.length > 0) {
        await applyAdditionalSites(created.id, additionalSiteIds, []);
      }
      return created;
    },
    onSuccess: async (created) => {
      setFullName('');
      setEmail('');
      setPassword('');
      setAdditionalSiteIds([]);
      await Promise.all([
        qc.invalidateQueries({ queryKey: qk.users }),
        qc.invalidateQueries({ queryKey: qk.foremanAssignments(created.id) }),
      ]);
    },
    onError: (e) =>
      Alert.alert(
        t('common.error'),
        e instanceof ApiError && e.code === 'USER_EMAIL_EXISTS'
          ? t('users.emailExists')
          : e instanceof ApiError
            ? e.message
            : String(e),
      ),
  });

  const lockMut = useMutation({
    mutationFn: (v: { id: string; locked: boolean }) => endpoints.lockoutUser(v.id, v.locked),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.users }),
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => endpoints.removeUser(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.users }),
  });

  const primaryOptions = sites.map((s) => ({ value: s.id, label: s.name }));

  return (
    <Screen>
      <Title>{t('users.title')}</Title>

      <Card>
        <SectionHeading>{t('users.add')}</SectionHeading>
        <SectionHeading>{t('users.role')}</SectionHeading>
        <Segmented
          options={roleOptions(t, currentUser?.role)}
          value={role}
          onChange={(next) => {
            setRole(next);
            // Leaving FOREMAN drops any picked additional sites (none are sent).
            if (next !== Role.FOREMAN) setAdditionalSiteIds([]);
          }}
        />
        <Field label={t('users.fullName')} value={fullName} onChangeText={setFullName} />
        <Field
          label={t('users.email')}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        {primaryOptions.length > 0 ? (
          <>
            <SectionHeading>{t('users.site')}</SectionHeading>
            <Segmented
              options={primaryOptions}
              value={primarySiteId}
              onChange={(next) => {
                setPrimarySiteId(next);
                // The new primary can't also be an additional site.
                setAdditionalSiteIds((prev) => prev.filter((id) => id !== next));
              }}
            />
            {role === Role.FOREMAN ? (
              <>
                <SectionHeading>{t('users.additionalSites')}</SectionHeading>
                <Body muted>{t('users.additionalSitesHint')}</Body>
                <MultiSelectChips
                  options={additionalOptions(sites, primarySiteId)}
                  value={additionalSiteIds}
                  onChange={setAdditionalSiteIds}
                />
              </>
            ) : null}
          </>
        ) : null}
        <Field
          label={t('users.initialPassword')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        <Body muted>{t('users.inviteHint')}</Body>
        <View style={{ height: 8 }} />
        <Button
          title={t('common.add')}
          onPress={() => addMut.mutate()}
          loading={addMut.isPending}
          disabled={!fullName || !email}
        />
      </Card>

      {usersQ.isLoading ? (
        <Loading />
      ) : !usersQ.data || usersQ.data.items.length === 0 ? (
        <EmptyState label={t('users.noUsers')} />
      ) : (
        usersQ.data.items.map((u) => (
          <UserCard key={u.id} user={u} sites={sites} lockMut={lockMut} removeMut={removeMut} />
        ))
      )}
    </Screen>
  );
}

/**
 * One user row + inline management. For a FOREMAN it loads the current active
 * assignments and exposes the ADDITIONAL SITES multi-select with a diff-save that
 * POSTs/DELETEs the delta; non-foreman rows just show lockout/remove.
 */
function UserCard({
  user,
  sites,
  lockMut,
  removeMut,
}: {
  user: User;
  sites: Site[];
  lockMut: ReturnType<typeof useMutation<User, unknown, { id: string; locked: boolean }>>;
  removeMut: ReturnType<typeof useMutation<void, unknown, string>>;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const isForeman = user.role === Role.FOREMAN;

  const assignmentsQ = useQuery({
    queryKey: qk.foremanAssignments(user.id),
    queryFn: () => endpoints.listForemanAssignments(user.id),
    enabled: isForeman,
  });

  // Server truth: active assignment siteIds minus the primary (defensive — the
  // primary should not appear as an assignment, but keep the additional set clean).
  const currentSiteIds = useMemo(
    () =>
      ((assignmentsQ.data ?? []) as ForemanSiteAssignment[])
        .map((a) => a.siteId)
        .filter((id) => id !== user.primarySiteId),
    [assignmentsQ.data, user.primarySiteId],
  );

  // Local edit buffer, seeded from server truth once loaded; reset on save.
  const [selected, setSelected] = useState<string[] | null>(null);
  const value = selected ?? currentSiteIds;
  const dirty =
    selected !== null &&
    (selected.length !== currentSiteIds.length ||
      selected.some((id) => !currentSiteIds.includes(id)));

  const saveMut = useMutation({
    mutationFn: () => applyAdditionalSites(user.id, value, currentSiteIds),
    onSuccess: async () => {
      setSelected(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: qk.foremanAssignments(user.id) }),
        qc.invalidateQueries({ queryKey: qk.users }),
      ]);
    },
    onError: (e) =>
      Alert.alert(t('common.error'), e instanceof ApiError ? e.message : String(e)),
  });

  return (
    <Card>
      <Row style={{ justifyContent: 'space-between' }}>
        <View>
          <Body>{user.fullName}</Body>
          <Body muted>{user.email}</Body>
        </View>
        <StatusPill
          label={user.isLockedOut ? t('users.lockedOut') : t(`roles.${user.role}`)}
          tone={user.isLockedOut ? 'danger' : 'info'}
        />
      </Row>

      {isForeman && sites.length > 0 ? (
        <View style={{ marginTop: 8 }}>
          <SectionHeading>{t('users.additionalSites')}</SectionHeading>
          {assignmentsQ.isLoading ? (
            <Loading />
          ) : (
            <>
              <MultiSelectChips
                options={additionalOptions(sites, user.primarySiteId ?? null)}
                value={value}
                onChange={setSelected}
              />
              {dirty ? (
                <Button
                  title={t('users.saveSites')}
                  onPress={() => saveMut.mutate()}
                  loading={saveMut.isPending}
                />
              ) : null}
            </>
          )}
        </View>
      ) : null}

      <Row>
        <View style={{ flex: 1, marginEnd: 8 }}>
          <Button
            title={user.isLockedOut ? t('users.unlock') : t('users.lockout')}
            variant="secondary"
            onPress={() => lockMut.mutate({ id: user.id, locked: !user.isLockedOut })}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            title={t('common.remove')}
            variant="danger"
            onPress={() =>
              Alert.alert(t('users.removeConfirm'), '', [
                { text: t('common.cancel'), style: 'cancel' },
                {
                  text: t('common.remove'),
                  style: 'destructive',
                  onPress: () => removeMut.mutate(user.id),
                },
              ])
            }
          />
        </View>
      </Row>
    </Card>
  );
}
