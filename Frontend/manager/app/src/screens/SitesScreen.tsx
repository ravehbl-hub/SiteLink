/**
 * Sites (FR-MGR-SITE). List/create/archive construction sites. Details/CRUD are
 * surfaced inline; archive per FR-MGR-SITE-1/3.
 */
import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { SiteStatus } from '@sitelink/shared';
import { endpoints } from '../lib/endpoints';
import { qk } from '../lib/queryKeys';
import { ApiError } from '../lib/api';
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
  StatusPill,
  Title,
} from '../components/ui';

export function SitesScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [address, setAddress] = useState('');

  const q = useQuery({ queryKey: qk.sites(true), queryFn: () => endpoints.listSites(true) });

  const addMut = useMutation({
    mutationFn: () =>
      endpoints.createSite({
        name: name.trim(),
        code: code.trim() || null,
        address: address.trim() || null,
      }),
    onSuccess: async () => {
      setName('');
      setCode('');
      setAddress('');
      await qc.invalidateQueries({ queryKey: ['sites'] });
    },
    onError: (e) => Alert.alert(t('common.error'), e instanceof ApiError ? e.message : String(e)),
  });

  const archiveMut = useMutation({
    mutationFn: (id: string) => endpoints.archiveSite(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sites'] }),
  });

  return (
    <Screen>
      <Title>{t('sites.title')}</Title>

      <Card>
        <SectionHeading>{t('sites.add')}</SectionHeading>
        <Field label={t('sites.name')} value={name} onChangeText={setName} />
        <Field label={t('sites.code')} value={code} onChangeText={setCode} />
        <Field label={t('sites.address')} value={address} onChangeText={setAddress} />
        <Button
          title={t('common.add')}
          onPress={() => addMut.mutate()}
          loading={addMut.isPending}
          disabled={!name}
        />
      </Card>

      {q.isLoading ? (
        <Loading />
      ) : !q.data || q.data.items.length === 0 ? (
        <EmptyState label={t('sites.noSites')} />
      ) : (
        q.data.items.map((s) => (
          <Card key={s.id}>
            <Row style={{ justifyContent: 'space-between' }}>
              <View>
                <Body>{s.name}</Body>
                <Body muted>{s.code ?? s.address ?? '—'}</Body>
              </View>
              <StatusPill
                label={s.status === SiteStatus.ACTIVE ? t('sites.active') : t('sites.archived')}
                tone={s.status === SiteStatus.ACTIVE ? 'success' : 'warning'}
              />
            </Row>
            {s.status === SiteStatus.ACTIVE ? (
              <Button
                title={t('common.archive')}
                variant="secondary"
                onPress={() =>
                  Alert.alert(t('sites.archiveConfirm'), '', [
                    { text: t('common.cancel'), style: 'cancel' },
                    { text: t('common.archive'), onPress: () => archiveMut.mutate(s.id) },
                  ])
                }
              />
            ) : null}
          </Card>
        ))
      )}
    </Screen>
  );
}
