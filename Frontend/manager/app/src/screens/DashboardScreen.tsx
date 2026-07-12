/**
 * Dashboard (FR-MGR-DASH). Consumes GET /dashboard → DashboardRollup. Defaults to
 * all-sites, current-month window (FR-MGR-DASH-1). Site + date filter drive the
 * rollup consistently (FR-MGR-DASH-5). Empty filter → zeros, not error (DASH-6).
 */
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Site } from '@sitelink/shared';
import { endpoints } from '../lib/endpoints';
import { qk } from '../lib/queryKeys';
import { currentMonthRange, money } from '../lib/format';
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
  Segmented,
  Title,
} from '../components/ui';
import { useTheme } from '../theme/ThemeProvider';

export function DashboardScreen() {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const [siteId, setSiteId] = useState<string | null>(null);
  const range = useMemo(currentMonthRange, []);

  const sitesQ = useQuery({
    queryKey: qk.sites(false),
    queryFn: () => endpoints.listSites(false),
  });

  const params = { siteId: siteId ?? undefined, from: range.from, to: range.to };
  const dashQ = useQuery({
    queryKey: qk.dashboard(params),
    queryFn: () => endpoints.dashboard(params),
  });

  const siteOptions = [
    { value: '__all__', label: t('dashboard.allSites') },
    ...((sitesQ.data?.items ?? []) as Site[]).map((s) => ({ value: s.id, label: s.name })),
  ];

  return (
    <Screen>
      <Title>{t('dashboard.title')}</Title>

      <SectionHeading>{t('dashboard.site')}</SectionHeading>
      <Segmented
        options={siteOptions}
        value={siteId ?? '__all__'}
        onChange={(v) => setSiteId(v === '__all__' ? null : v)}
      />

      {dashQ.isLoading ? (
        <Loading label={t('common.loading')} />
      ) : dashQ.isError ? (
        <ErrorState label={t('common.error')} onRetry={() => dashQ.refetch()} />
      ) : dashQ.data ? (
        <>
          <Card>
            <SectionHeading>{t('dashboard.workforce')}</SectionHeading>
            <Row style={{ justifyContent: 'space-between' }}>
              <Metric label={t('dashboard.workers')} value={dashQ.data.workers.amountOfWorkers} />
              <Metric
                label={t('dashboard.totalHours')}
                value={dashQ.data.workers.totalWorkHours}
              />
              <Metric
                label={t('dashboard.attendanceDays')}
                value={dashQ.data.workers.attendanceDays}
              />
              <Metric
                label={t('dashboard.vacationDays')}
                value={dashQ.data.workers.vacationDays}
              />
              <Metric
                label={t('dashboard.diseaseDays')}
                value={dashQ.data.workers.diseaseDays}
              />
              <Metric
                label={t('dashboard.loans')}
                value={money(dashQ.data.workers.loansTotal, dashQ.data.finance.currency)}
              />
              <Metric
                label={t('dashboard.advances')}
                value={money(
                  dashQ.data.workers.advancePaymentsTotal,
                  dashQ.data.finance.currency,
                )}
              />
            </Row>
          </Card>

          <Card>
            <SectionHeading>{t('dashboard.finance')}</SectionHeading>
            <Row style={{ justifyContent: 'space-between' }}>
              <Metric
                label={t('dashboard.salaryTotal')}
                value={money(dashQ.data.finance.salaryTotal, dashQ.data.finance.currency)}
              />
              <Metric
                label={t('dashboard.revenue')}
                value={money(
                  dashQ.data.finance.profitAndLoss.revenue,
                  dashQ.data.finance.currency,
                )}
              />
              <Metric
                label={t('dashboard.netProfit')}
                value={money(
                  dashQ.data.finance.profitAndLoss.netProfit,
                  dashQ.data.finance.currency,
                )}
              />
            </Row>
          </Card>

          <Card>
            <SectionHeading>{t('dashboard.workersPerSite')}</SectionHeading>
            {dashQ.data.workers.workersPerSite.length === 0 ? (
              <EmptyState label={t('dashboard.emptyState')} />
            ) : (
              dashQ.data.workers.workersPerSite.map((w) => (
                <Row key={w.siteId} style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
                  <Body>{w.siteName}</Body>
                  <Body muted>{w.workerCount}</Body>
                </Row>
              ))
            )}
          </Card>

          <View style={{ paddingVertical: 8 }}>
            <Body muted>
              {t('dashboard.computedAt', {
                time: new Date(dashQ.data.computedAt).toLocaleString(),
              })}
            </Body>
          </View>
        </>
      ) : (
        <EmptyState label={t('dashboard.emptyState')} />
      )}
      <View style={{ height: theme.tokens.spacing['8'] }} />
    </Screen>
  );
}
