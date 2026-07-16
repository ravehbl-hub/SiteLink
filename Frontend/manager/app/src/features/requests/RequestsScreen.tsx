/**
 * Requests inbox (FR-REQ) — the NEW worker-submission inbox, parity with the
 * Manager web Requests feature. The Manager LISTS all in-scope worker requests
 * (vacation / loan / advance) and resolves PENDING ones via approve/reject
 * (ADMIN/MANAGER only). Distinct from the Finance screen, which records
 * manager-created loan/advance ledger entries.
 *
 * Styling: Operations Deck dark-first tokens only (no hard-coded hex). PENDING
 * cards get a teal accent-glow ring (theme.glow.accent). RTL uses logical
 * marginStart/End.
 */
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  RequestStatus,
  RequestType,
  type Worker,
  type WorkerRequest,
} from '@sitelink/shared';
import { endpoints } from '../../lib/endpoints';
import { qk } from '../../lib/queryKeys';
import { money, shortDate } from '../../lib/format';
import { ApiError } from '../../lib/api';
import { useTheme } from '../../theme/ThemeProvider';
import {
  Body,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Loading,
  Row,
  ScreenPlain,
  SectionHeading,
  Segmented,
  StatusPill,
  Title,
} from '../../components/ui';

/** Filter values: the three request statuses plus an "all" pseudo-filter. */
type Filter = RequestStatus | 'ALL';

const STATUS_TONE: Record<RequestStatus, 'warning' | 'success' | 'danger'> = {
  [RequestStatus.PENDING]: 'warning',
  [RequestStatus.APPROVED]: 'success',
  [RequestStatus.REJECTED]: 'danger',
};

export function RequestsScreen() {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const qc = useQueryClient();
  // Default filter = PENDING (the inbox opens on what needs a decision).
  const [filter, setFilter] = useState<Filter>(RequestStatus.PENDING);

  const statusParam = filter === 'ALL' ? undefined : filter;
  const requestsQ = useQuery({
    queryKey: qk.requests({ status: statusParam }),
    queryFn: () => endpoints.listRequests({ status: statusParam }),
  });

  // Worker names are not on the WorkerRequest DTO — resolve via the workers list.
  const workersQ = useQuery({ queryKey: qk.workers(), queryFn: () => endpoints.listWorkers() });
  const workerName = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of (workersQ.data?.items ?? []) as Worker[]) {
      map.set(w.id, `${w.firstName} ${w.lastName}`.trim());
    }
    return (id: string) => map.get(id) ?? t('requests.unknownWorker');
  }, [workersQ.data, t]);

  const resolveMut = useMutation({
    mutationFn: (v: { id: string; action: 'approve' | 'reject' }) =>
      v.action === 'approve' ? endpoints.approveRequest(v.id) : endpoints.rejectRequest(v.id),
    onSuccess: async (_data, v) => {
      await qc.invalidateQueries({ queryKey: ['requests'] });
      Alert.alert(t(v.action === 'approve' ? 'requests.approved' : 'requests.rejected'));
    },
    onError: async (e) => {
      // 409 → the request was already resolved elsewhere; refetch to reconcile.
      if (e instanceof ApiError && e.status === 409) {
        await qc.invalidateQueries({ queryKey: ['requests'] });
        Alert.alert(t('common.error'), t('requests.alreadyResolved'));
        return;
      }
      Alert.alert(t('common.error'), e instanceof ApiError ? e.message : String(e));
    },
  });

  const confirm = (id: string, action: 'approve' | 'reject') =>
    Alert.alert(
      t(action === 'approve' ? 'requests.approveConfirm' : 'requests.rejectConfirm'),
      undefined,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t(action === 'approve' ? 'requests.approve' : 'requests.reject'),
          style: action === 'reject' ? 'destructive' : 'default',
          onPress: () => resolveMut.mutate({ id, action }),
        },
      ],
    );

  const filterOptions: { value: Filter; label: string }[] = [
    { value: RequestStatus.PENDING, label: t('requests.filterPending') },
    { value: RequestStatus.APPROVED, label: t('requests.filterApproved') },
    { value: RequestStatus.REJECTED, label: t('requests.filterRejected') },
    { value: 'ALL', label: t('requests.filterAll') },
  ];

  const typeLabel = (type: RequestType): string =>
    type === RequestType.VACATION
      ? t('requests.typeVacation')
      : type === RequestType.LOAN
        ? t('requests.typeLoan')
        : t('requests.typeAdvance');

  const statusLabel = (status: RequestStatus): string =>
    status === RequestStatus.PENDING
      ? t('requests.statusPending')
      : status === RequestStatus.APPROVED
        ? t('requests.statusApproved')
        : t('requests.statusRejected');

  const detail = (r: WorkerRequest): string => {
    if (r.type === RequestType.VACATION) {
      return t('requests.dateRange', { from: shortDate(r.startDate), to: shortDate(r.endDate) });
    }
    return r.amount != null ? money(r.amount, r.currency ?? 'ILS') : '—';
  };

  const renderItem = ({ item }: { item: WorkerRequest }) => {
    const pending = item.status === RequestStatus.PENDING;
    const busy = resolveMut.isPending && resolveMut.variables?.id === item.id;
    return (
      <Card
        style={
          pending
            ? {
                borderColor: theme.glow.accent.color,
                marginHorizontal: Number(theme.tokens.spacing['4']),
              }
            : { marginHorizontal: Number(theme.tokens.spacing['4']) }
        }
      >
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flexShrink: 1, marginEnd: Number(theme.tokens.spacing['2']) }}>
            <Body>{workerName(item.workerId)}</Body>
            <Body muted>{typeLabel(item.type)}</Body>
          </View>
          <StatusPill label={statusLabel(item.status)} tone={STATUS_TONE[item.status]} />
        </Row>

        <View style={{ marginTop: Number(theme.tokens.spacing['2']) }}>
          <Body>{detail(item)}</Body>
          <Body muted>{t('requests.submitted', { date: shortDate(item.createdAt) })}</Body>
          {item.notes ? <Body muted>{item.notes}</Body> : null}
        </View>

        {pending ? (
          <Row
            style={{
              justifyContent: 'flex-end',
              marginTop: Number(theme.tokens.spacing['3']),
              gap: Number(theme.tokens.spacing['2']),
            }}
          >
            {busy ? (
              <ActivityIndicator color={theme.colors.accent} />
            ) : (
              <>
                <View style={{ minWidth: 120 }}>
                  <Button
                    title={t('requests.reject')}
                    variant="danger"
                    onPress={() => confirm(item.id, 'reject')}
                  />
                </View>
                <View style={{ minWidth: 120 }}>
                  <Button
                    title={t('requests.approve')}
                    onPress={() => confirm(item.id, 'approve')}
                  />
                </View>
              </>
            )}
          </Row>
        ) : null}
      </Card>
    );
  };

  return (
    <ScreenPlain>
      <View
        style={{
          paddingHorizontal: Number(theme.tokens.spacing['4']),
          paddingTop: Number(theme.tokens.spacing['4']),
        }}
      >
        <Title>{t('requests.title')}</Title>
        <SectionHeading>{t('requests.subtitle')}</SectionHeading>
        <Segmented options={filterOptions} value={filter} onChange={setFilter} />
      </View>

      {requestsQ.isLoading ? (
        <Loading />
      ) : requestsQ.isError ? (
        <ErrorState label={t('requests.loadError')} onRetry={() => requestsQ.refetch()} />
      ) : (requestsQ.data ?? []).length === 0 ? (
        <EmptyState label={t('requests.none')} />
      ) : (
        <FlatList
          data={requestsQ.data ?? []}
          keyExtractor={(r) => r.id}
          renderItem={renderItem}
          refreshing={requestsQ.isRefetching}
          onRefresh={() => requestsQ.refetch()}
          contentContainerStyle={{ paddingVertical: Number(theme.tokens.spacing['3']) }}
        />
      )}
    </ScreenPlain>
  );
}
