/**
 * Users Manager (FR-MGR-USER). List users; add a user (role + name + site + email
 * + optional password → server dual-writes Supabase identity + app User); edit,
 * lockout (reversible), and remove. Credentials are managed by Supabase (no
 * password stored here beyond the optional initial one passed to provisioning).
 */
import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Role, type CreateUserInput, type Site } from '@sitelink/shared';
import { endpoints } from '../lib/endpoints';
import { qk } from '../lib/queryKeys';
import { ApiError } from '../lib/api';
import { roleOptions } from '../lib/enumOptions';
import {
  Body,
  Button,
  Card,
  EmptyState,
  Field,
  Loading,
  Row,
  Screen,
  SectionHeading,
  Segmented,
  StatusPill,
  Title,
} from '../components/ui';

export function UsersScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>(Role.FOREMAN);
  const [primarySiteId, setPrimarySiteId] = useState<string | null>(null);

  const usersQ = useQuery({ queryKey: qk.users, queryFn: () => endpoints.listUsers() });
  const sitesQ = useQuery({ queryKey: qk.sites(false), queryFn: () => endpoints.listSites(false) });

  const addMut = useMutation({
    mutationFn: () => {
      const body: CreateUserInput = {
        role,
        fullName: fullName.trim(),
        email: email.trim(),
        primarySiteId,
      };
      if (password.trim()) body.password = password.trim();
      return endpoints.createUser(body);
    },
    onSuccess: async () => {
      setFullName('');
      setEmail('');
      setPassword('');
      await qc.invalidateQueries({ queryKey: qk.users });
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

  const siteOptions = ((sitesQ.data?.items ?? []) as Site[]).map((s) => ({
    value: s.id,
    label: s.name,
  }));

  return (
    <Screen>
      <Title>{t('users.title')}</Title>

      <Card>
        <SectionHeading>{t('users.add')}</SectionHeading>
        <SectionHeading>{t('users.role')}</SectionHeading>
        <Segmented options={roleOptions(t)} value={role} onChange={setRole} />
        <Field label={t('users.fullName')} value={fullName} onChangeText={setFullName} />
        <Field
          label={t('users.email')}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        {siteOptions.length > 0 ? (
          <>
            <SectionHeading>{t('users.site')}</SectionHeading>
            <Segmented options={siteOptions} value={primarySiteId} onChange={setPrimarySiteId} />
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
          <Card key={u.id}>
            <Row style={{ justifyContent: 'space-between' }}>
              <View>
                <Body>{u.fullName}</Body>
                <Body muted>{u.email}</Body>
              </View>
              <StatusPill
                label={u.isLockedOut ? t('users.lockedOut') : t(`roles.${u.role}`)}
                tone={u.isLockedOut ? 'danger' : 'info'}
              />
            </Row>
            <Row>
              <View style={{ flex: 1, marginEnd: 8 }}>
                <Button
                  title={u.isLockedOut ? t('users.unlock') : t('users.lockout')}
                  variant="secondary"
                  onPress={() => lockMut.mutate({ id: u.id, locked: !u.isLockedOut })}
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
                        onPress: () => removeMut.mutate(u.id),
                      },
                    ])
                  }
                />
              </View>
            </Row>
          </Card>
        ))
      )}
    </Screen>
  );
}
