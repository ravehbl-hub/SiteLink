/**
 * Reports (FR-FOR-3). Worker-count summary for the Foreman's OWN site. Primary
 * source is the dashboard rollup (workers.amountOfWorkers + attendance day-counts);
 * GET /worker-count is used as a direct headcount cross-check. No site picker.
 */
import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../lib/endpoints';
import { qk } from '../lib/queryKeys';
import { currentMonthRange } from '../lib/format';
import { useAuth } from '../auth/AuthProvider';
import {
  Body,
  Card,
  EmptyState,
  ErrorState,
  Loading,
  Metric,
  Row,
  Screen,
  SectionHeading,
  Title,
} from '../components/ui';

export function ReportsScreen() {
  const { t } = useTranslation();
  const { primarySiteId } = useAuth();
  const range = useMemo(currentMonthRange, []);

  const params = { siteId: primarySiteId ?? undefined, from: range.from, to: range.to };

  const dashQ = useQuery({
    queryKey: qk.dashboard(params),
    queryFn: () => endpoints.dashboard(params),
    enabled: Boolean(primarySiteId),
  });

  const countQ = useQuery({
    queryKey: qk.workerCount(primarySiteId),
    queryFn: () => endpoints.workerCount({ siteId: primarySiteId ?? undefined }),
    enabled: Boolean(primarySiteId),
  });

  if (!primarySiteId) {
    return (
      <Screen>
        <Title>{t('reports.title')}</Title>
        <Card>
          <EmptyState label={t('common.noSiteAssigned')} />
        </Card>
      </Screen>
    );
  }

  const w = dashQ.data?.workers;

  return (
    <Screen>
      <Title>{t('reports.title')}</Title>

      {dashQ.isLoading ? (
        <Loading label={t('common.loading')} />
      ) : dashQ.isError ? (
        <ErrorState label={t('common.error')} onRetry={() => dashQ.refetch()} />
      ) : w ? (
        <>
          <Card>
            <SectionHeading>{t('reports.workerCount')}</SectionHeading>
            <Row style={{ justifyContent: 'space-between' }}>
              <Metric label={t('reports.totalWorkers')} value={w.amountOfWorkers} />
              {countQ.data ? (
                <Metric label={t('reports.currentHeadcount')} value={countQ.data.count} />
              ) : null}
            </Row>
          </Card>

          <Card>
            <SectionHeading>{t('reports.attendanceSummary')}</SectionHeading>
            <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
              <Body muted>{t('attendance.present')}</Body>
              <Body>{w.attendanceDays}</Body>
            </Row>
            <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
              <Body muted>{t('attendance.vacation')}</Body>
              <Body>{w.vacationDays}</Body>
            </Row>
            <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
              <Body muted>{t('attendance.disease')}</Body>
              <Body>{w.diseaseDays}</Body>
            </Row>
            <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
              <Body muted>{t('dashboard.totalHours')}</Body>
              <Body>{w.totalWorkHours}</Body>
            </Row>
          </Card>
        </>
      ) : (
        <EmptyState label={t('reports.empty')} />
      )}
    </Screen>
  );
}
