/**
 * Workers list (FR-MGR-EMP). An Active ⇄ Archived view switch: Active lists live
 * workers, Archived lists ONLY archived ones (server ?archivedOnly=true), each
 * with a Restore action. Search applies (ANDed server-side) in both views. Taps
 * open details; the + button starts the Worker Wizard.
 */
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../lib/endpoints';
import { qk } from '../../lib/queryKeys';
import { useTheme } from '../../theme/ThemeProvider';
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

/** Debounce a value by `delay` ms (used for the search box → server-side ?search). */
function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

type Props = NativeStackScreenProps<WorkersStackParamList, 'WorkersList'>;

export function WorkersListScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const qc = useQueryClient();
  // Active ⇄ Archived view. Archived shows ONLY archived rows (server-side).
  const [archived, setArchived] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounced(searchInput.trim(), 300);
  // Only send `search` when a term is present; undefined keeps the full scoped list.
  const search = debouncedSearch.length > 0 ? debouncedSearch : undefined;

  // Archived view → GET /workers?archivedOnly=true; Active view → default GET /workers.
  // archivedOnly is part of the query key so each view refetches/caches independently.
  const params = { archivedOnly: archived || undefined, search };

  const q = useQuery({
    queryKey: qk.workers(params),
    queryFn: () => endpoints.listWorkers(params),
  });

  // Restore an archived worker (MANAGER-only). On success invalidate the whole
  // ['workers'] namespace so the row leaves the Archived view (and rejoins Active).
  const restoreMut = useMutation({
    mutationFn: (id: string) => endpoints.unarchiveWorker(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workers'] }),
  });

  const confirmRestore = (id: string) =>
    Alert.alert(t('workers.restore'), t('workers.confirmRestore'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('workers.restore'), onPress: () => restoreMut.mutate(id) },
    ]);

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between' }}>
        <Title>{t('workers.title')}</Title>
      </Row>
      <Button title={t('workers.add')} onPress={() => navigation.navigate('WorkerWizard')} />
      <TextInput
        value={searchInput}
        onChangeText={setSearchInput}
        placeholder={t('workers.searchPlaceholder')}
        placeholderTextColor={theme.colors.textMuted}
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
        style={{
          borderColor: theme.colors.border,
          borderWidth: 1,
          borderRadius: Number(theme.tokens.radii.sm),
          paddingVertical: Number(theme.tokens.spacing['2']),
          paddingHorizontal: Number(theme.tokens.spacing['3']),
          marginBottom: Number(theme.tokens.spacing['3']),
          color: theme.colors.textPrimary,
          backgroundColor: theme.colors.surface,
          textAlign: 'auto',
        }}
      />
      <Segmented
        options={[
          { value: 'active', label: t('workers.viewActive') },
          { value: 'archived', label: t('workers.viewArchived') },
        ]}
        value={archived ? 'archived' : 'active'}
        onChange={(v) => setArchived(v === 'archived')}
      />

      {q.isLoading ? (
        <Loading label={t('common.loading')} />
      ) : q.isError ? (
        <ErrorState label={t('common.error')} onRetry={() => q.refetch()} />
      ) : !q.data || q.data.items.length === 0 ? (
        <EmptyState label={archived ? t('workers.noArchived') : t('common.empty')} />
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
              {archived ? (
                <Button
                  title={t('workers.restore')}
                  variant="secondary"
                  onPress={() => confirmRestore(w.id)}
                  loading={restoreMut.isPending && restoreMut.variables === w.id}
                />
              ) : null}
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  );
}
