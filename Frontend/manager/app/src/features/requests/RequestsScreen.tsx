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
import { live, POLL, STALE } from '../../lib/polling';
import { money, shortDate } from '../../lib/format';
import { ApiError } from '../../lib/api';
import { useAuth } from '../../auth/AuthProvider';
import { useTheme } from '../../theme/ThemeProvider';
import { Role } from '@sitelink/shared';
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
  const { user } = useAuth();
  const qc = useQueryClient();

  // Re-decide (flipping an already-RESOLVED request) is an ADMIN/MANAGER-only action
  // with real financial side effects — gate the UI to those roles (backend re-gates).
  const canRedecide = user?.role === Role.ADMIN || user?.role === Role.MANAGER;
  // Default filter = ALL (the inbox opens showing every request status).
  const [filter, setFilter] = useState<Filter>('ALL');

  const statusParam = filter === 'ALL' ? undefined : filter;
  const requestsQ = useQuery({
    queryKey: qk.requests({ status: statusParam }),
    queryFn: () => endpoints.listRequests({ status: statusParam }),
    ...live(POLL.requests, STALE.live),
  });

  // Worker names are not on the WorkerRequest DTO — resolve via the workers list.
  // Reference lookup: workers change rarely, so long staleTime (no polling here).
  const workersQ = useQuery({
    queryKey: qk.workers(),
    queryFn: () => endpoints.listWorkers(),
    staleTime: STALE.reference,
  });
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

  // RE-DECIDE: flip an already-RESOLVED request to the other terminal status. The
  // backend atomically reverses/re-applies the loan/advance/vacation side effect, so
  // on success we invalidate not only the requests list but also the dashboard and the
  // finance (loans/advances) queries that reflect those side effects.
  const redecideMut = useMutation({
    mutationFn: (v: { id: string; target: RequestStatus }) =>
      endpoints.redecideRequest(v.id, { status: v.target }),
    onSuccess: async (_data, v) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['requests'] }),
        qc.invalidateQueries({ queryKey: ['dashboard'] }),
        qc.invalidateQueries({ queryKey: ['loans'] }),
        qc.invalidateQueries({ queryKey: ['advances'] }),
      ]);
      Alert.alert(
        t(
          v.target === RequestStatus.APPROVED
            ? 'requests.redecidedApproved'
            : 'requests.redecidedRejected',
        ),
      );
    },
    onError: async (e) => {
      // 409 covers the CAS lost-update AND the partial-repayment reversal block; the
      // backend sends a precise message — surface it verbatim so the manager sees why.
      if (e instanceof ApiError && e.status === 409) {
        await qc.invalidateQueries({ queryKey: ['requests'] });
        Alert.alert(t('requests.redecideConflictTitle'), e.message);
        return;
      }
      Alert.alert(t('common.error'), e instanceof ApiError ? e.message : String(e));
    },
  });

  // Confirm the flip UNAMBIGUOUSLY: explicit current→target status and a warning that
  // this reverses/re-applies the loan/advance/vacation side effect.
  const confirmRedecide = (r: WorkerRequest) => {
    const target =
      r.status === RequestStatus.APPROVED ? RequestStatus.REJECTED : RequestStatus.APPROVED;
    Alert.alert(
      t('requests.redecideConfirmTitle'),
      t('requests.redecideConfirmBody', {
        from: statusLabel(r.status),
        to: statusLabel(target),
      }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('requests.redecideConfirmCta', { status: statusLabel(target) }),
          style: target === RequestStatus.REJECTED ? 'destructive' : 'default',
          onPress: () => redecideMut.mutate({ id: r.id, target }),
        },
      ],
    );
  };

  const filterOptions: { value: Filter; label: string }[] = [
    { value: 'ALL', label: t('requests.filterAll') },
    { value: RequestStatus.PENDING, label: t('requests.filterPending') },
    { value: RequestStatus.APPROVED, label: t('requests.filterApproved') },
    { value: RequestStatus.REJECTED, label: t('requests.filterRejected') },
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
    const resolved = !pending; // APPROVED or REJECTED
    const busy = resolveMut.isPending && resolveMut.variables?.id === item.id;
    const redeciding = redecideMut.isPending && redecideMut.variables?.id === item.id;
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

        {/* RESOLVED (not pending) → ADMIN/MANAGER can re-decide (flip the decision). */}
        {resolved && canRedecide ? (
          <Row
            style={{
              justifyContent: 'flex-end',
              marginTop: Number(theme.tokens.spacing['3']),
            }}
          >
            {redeciding ? (
              <ActivityIndicator color={theme.colors.accent} />
            ) : (
              <View style={{ minWidth: 140 }}>
                <Button
                  title={t('requests.redecide')}
                  variant="secondary"
                  onPress={() => confirmRedecide(item)}
                />
              </View>
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
