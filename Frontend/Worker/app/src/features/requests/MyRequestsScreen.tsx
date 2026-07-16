/**
 * My Requests (FR-WRK). Self-scoped: GET /requests returns ONLY the caller's own
 * requests. Unified list with a StatusPill
 * (PENDING=warning, APPROVED=success, REJECTED=danger).
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { RequestStatus, type WorkerRequest } from '@sitelink/shared';
import { endpoints } from '../../lib/endpoints';
import { qk } from '../../lib/queryKeys';
import { money, shortDate } from '../../lib/format';
import {
  Body,
  Card,
  EmptyState,
  ErrorState,
  Loading,
  Row,
  Screen,
  StatusPill,
  Title,
} from '../../components/ui';

type Tone = 'success' | 'warning' | 'danger';

function toneFor(status: RequestStatus): Tone {
  switch (status) {
    case RequestStatus.APPROVED:
      return 'success';
    case RequestStatus.REJECTED:
      return 'danger';
    default:
      return 'warning';
  }
}

export function MyRequestsScreen() {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: qk.requests(),
    queryFn: () => endpoints.listRequests(),
  });

  const rows = (q.data ?? []) as WorkerRequest[];

  if (q.isLoading) return <Loading />;
  if (q.isError)
    return <ErrorState label={t('common.loadFailed')} onRetry={() => void q.refetch()} />;

  return (
    <Screen>
      <Title>{t('myRequests.title')}</Title>

      {rows.length === 0 ? (
        <EmptyState label={t('myRequests.empty')} />
      ) : (
        rows.map((r) => (
          <Card key={r.id}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Body>{t(`requestType.${r.type}`)}</Body>
              <StatusPill label={t(`requestStatus.${r.status}`)} tone={toneFor(r.status)} />
            </Row>
            {r.startDate || r.endDate ? (
              <Row style={{ justifyContent: 'space-between', paddingVertical: 2 }}>
                <Body muted>{t('myRequests.dates')}</Body>
                <Body muted numeric>
                  {shortDate(r.startDate)} – {shortDate(r.endDate)}
                </Body>
              </Row>
            ) : null}
            {r.amount != null ? (
              <Row style={{ justifyContent: 'space-between', paddingVertical: 2 }}>
                <Body muted>{t('myRequests.amount')}</Body>
                <Body muted numeric>{money(r.amount, r.currency ?? 'ILS')}</Body>
              </Row>
            ) : null}
            {r.notes ? (
              <Row style={{ justifyContent: 'space-between', paddingVertical: 2 }}>
                <Body muted>{t('myRequests.notes')}</Body>
                <Body muted>{r.notes}</Body>
              </Row>
            ) : null}
            <Row style={{ justifyContent: 'space-between', paddingVertical: 2 }}>
              <Body muted>{t('myRequests.submittedOn')}</Body>
              <Body muted numeric>{shortDate(r.createdAt)}</Body>
            </Row>
          </Card>
        ))
      )}
    </Screen>
  );
}
