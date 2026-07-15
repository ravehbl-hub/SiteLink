/**
 * Workers list (FR-MGR-EMP). Lists active workers with an archived toggle; taps
 * open details; the + button starts the Worker Wizard.
 */
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../lib/endpoints';
import { qk } from '../../lib/queryKeys';
import type { WorkersStackParamList } from '../../navigation/types';
import {
  Body,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Loading,
  Row,
  Screen,
  Segmented,
  StatusPill,
  Title,
} from '../../components/ui';

type Props = NativeStackScreenProps<WorkersStackParamList, 'WorkersList'>;

export function WorkersListScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [includeArchived, setIncludeArchived] = useState(false);

  const q = useQuery({
    queryKey: qk.workers({ includeArchived }),
    queryFn: () => endpoints.listWorkers({ includeArchived }),
  });

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between' }}>
        <Title>{t('workers.title')}</Title>
      </Row>
      <Button title={t('workers.add')} onPress={() => navigation.navigate('WorkerWizard')} />
      <Segmented
        options={[
          { value: 'active', label: t('sites.active') },
          { value: 'archived', label: t('workers.includeArchived') },
        ]}
        value={includeArchived ? 'archived' : 'active'}
        onChange={(v) => setIncludeArchived(v === 'archived')}
      />

      {q.isLoading ? (
        <Loading label={t('common.loading')} />
      ) : q.isError ? (
        <ErrorState label={t('common.error')} onRetry={() => q.refetch()} />
      ) : !q.data || q.data.items.length === 0 ? (
        <EmptyState label={t('common.empty')} />
      ) : (
        q.data.items.map((w) => (
          <Pressable
            key={w.id}
            onPress={() => navigation.navigate('WorkerDetails', { workerId: w.id })}
          >
            <Card>
              <Row style={{ justifyContent: 'space-between' }}>
                <View>
                  <Body>
                    {w.firstName} {w.lastName}
                  </Body>
                  <Body muted>{t(`professions.${w.profession}`)}</Body>
                </View>
                <Row>
                  {/* item 12: flag legacy login-less workers (userId null). */}
                  {w.userId == null ? (
                    <StatusPill label={t('workers.noLogin')} tone="warning" />
                  ) : null}
                  {w.isArchived ? (
                    <StatusPill label={t('workers.archived')} tone="warning" />
                  ) : (
                    <StatusPill label={t(`levels.${w.level}`)} tone="info" />
                  )}
                </Row>
              </Row>
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  );
}
