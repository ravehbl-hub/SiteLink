/**
 * Dashboard (FR-MGR-DASH). Consumes GET /dashboard → DashboardRollup. Defaults to
 * all-sites, current-month window (FR-MGR-DASH-1). Site + date filter drive the
 * rollup consistently (FR-MGR-DASH-5). Empty filter → zeros, not error (DASH-6).
 *
 * Presents the SAME rollup as a DATA (KPI/tabular) view or a GRAPHICS view (three
 * react-native-svg charts), toggled by a segmented control whose choice persists
 * via expo-secure-store — mirroring the web Dashboard's Data | Graphics toggle.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { DashboardRollup, Site } from '@sitelink/shared';
import { endpoints } from '../../lib/endpoints';
import { qk } from '../../lib/queryKeys';
import { currentMonthRange, money } from '../../lib/format';
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
} from '../../components/ui';
import { BarChart, DonutChart, type Datum } from '../../components/charts';
import {
  loadDashboardViewPref,
  saveDashboardViewPref,
  type DashboardView,
} from '../../lib/prefs';
import { useTheme } from '../../theme/ThemeProvider';

export function DashboardScreen() {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const [siteId, setSiteId] = useState<string | null>(null);
  const [view, setViewState] = useState<DashboardView>('data');
  const range = useMemo(currentMonthRange, []);

  useEffect(() => {
    let active = true;
    void loadDashboardViewPref().then((v) => {
      if (active && v) setViewState(v);
    });
    return () => {
      active = false;
    };
  }, []);

  const setView = (next: DashboardView) => {
    setViewState(next);
    void saveDashboardViewPref(next);
  };

  const viewOptions = [
    { value: 'data' as const, label: t('dashboard.viewData') },
    { value: 'graphics' as const, label: t('dashboard.viewGraphics') },
  ];

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

      <Segmented options={viewOptions} value={view} onChange={setView} />

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
        view === 'graphics' ? (
          <GraphicsView data={dashQ.data} t={t} theme={theme} />
        ) : (
        <>
          <Card glow>
            <SectionHeading>{t('dashboard.workforce')}</SectionHeading>
            <Row style={{ justifyContent: 'space-between' }}>
              <Metric glow label={t('dashboard.workers')} value={dashQ.data.workers.amountOfWorkers} />
              <Metric
                glow
                label={t('dashboard.totalHours')}
                value={dashQ.data.workers.totalWorkHours}
              />
              <Metric
                glow
                label={t('dashboard.attendanceDays')}
                value={dashQ.data.workers.attendanceDays}
              />
              <Metric
                glow
                label={t('dashboard.vacationDays')}
                value={dashQ.data.workers.vacationDays}
              />
              <Metric
                glow
                label={t('dashboard.diseaseDays')}
                value={dashQ.data.workers.diseaseDays}
              />
              <Metric
                glow
                label={t('dashboard.loans')}
                value={money(dashQ.data.workers.loansTotal, dashQ.data.finance.currency)}
              />
              <Metric
                glow
                label={t('dashboard.advances')}
                value={money(
                  dashQ.data.workers.advancePaymentsTotal,
                  dashQ.data.finance.currency,
                )}
              />
            </Row>
          </Card>

          <Card glow>
            <SectionHeading>{t('dashboard.finance')}</SectionHeading>
            <Row style={{ justifyContent: 'space-between' }}>
              <Metric
                glow
                label={t('dashboard.salaryTotal')}
                value={money(dashQ.data.finance.salaryTotal, dashQ.data.finance.currency)}
              />
              <Metric
                glow
                label={t('dashboard.revenue')}
                value={money(
                  dashQ.data.finance.profitAndLoss.revenue,
                  dashQ.data.finance.currency,
                )}
              />
              <Metric
                glow
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
                  <Body muted tabular>{w.workerCount}</Body>
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
        )
      ) : (
        <EmptyState label={t('dashboard.emptyState')} />
      )}
      <View style={{ height: theme.tokens.spacing['8'] }} />
    </Screen>
  );
}

type TFn = ReturnType<typeof useTranslation>['t'];
type Theme = ReturnType<typeof useTheme>['theme'];

/**
 * GRAPHICS view: three react-native-svg charts from the SAME DashboardRollup —
 * no new endpoint. Colors are drawn from the active token Theme so dark/light
 * both look correct; RTL is handled inside the chart components.
 *  - workers.workersPerSite[]                        → BAR (headcount per site)
 *  - finance.profitAndLoss.{revenue,salaryCost,…}    → BAR (revenue vs costs)
 *  - workers.{attendanceDays,vacationDays,diseaseDays} → DONUT
 */
function GraphicsView({
  data,
  t,
  theme,
}: {
  data: DashboardRollup;
  t: TFn;
  theme: Theme;
}) {
  const currency = data.finance.currency;
  const pnl = data.finance.profitAndLoss;

  const siteBars: Datum[] = data.workers.workersPerSite.map((w) => ({
    label: w.siteName,
    value: w.workerCount,
    color: theme.colors.accent,
  }));

  const financeBars: Datum[] = [
    { label: t('dashboard.revenue'), value: Math.max(0, pnl.revenue), color: theme.colors.success },
    { label: t('dashboard.salaryCost'), value: Math.max(0, pnl.salaryCost), color: theme.colors.accent },
    { label: t('finance.loans'), value: Math.max(0, pnl.loansCost), color: theme.colors.info },
    { label: t('finance.advances'), value: Math.max(0, pnl.advancesCost), color: theme.colors.warning },
    {
      label: t('dashboard.netProfit'),
      value: Math.max(0, pnl.netProfit),
      color: pnl.netProfit >= 0 ? theme.colors.success : theme.colors.danger,
    },
  ];

  const workforceSlices: Datum[] = [
    { label: t('dashboard.attendanceDays'), value: data.workers.attendanceDays, color: theme.colors.success },
    { label: t('dashboard.vacationDays'), value: data.workers.vacationDays, color: theme.colors.info },
    { label: t('dashboard.diseaseDays'), value: data.workers.diseaseDays, color: theme.colors.warning },
  ];

  return (
    <>
      {siteBars.length > 0 ? (
        <Card>
          <SectionHeading>{t('dashboard.workersPerSite')}</SectionHeading>
          <BarChart data={siteBars} formatValue={(v) => String(v)} />
        </Card>
      ) : null}

      <Card>
        <SectionHeading>{t('dashboard.financeChart')}</SectionHeading>
        <BarChart data={financeBars} formatValue={(v) => money(v, currency)} />
      </Card>

      <Card>
        <SectionHeading>{t('dashboard.workforceChart')}</SectionHeading>
        <DonutChart
          data={workforceSlices}
          totalLabel={t('dashboard.chartTotal')}
          emptyLabel={t('dashboard.chartNoData')}
          formatValue={(v) => String(v)}
        />
      </Card>

      <View style={{ paddingVertical: 8 }}>
        <Body muted>
          {t('dashboard.computedAt', {
            time: new Date(data.computedAt).toLocaleString(),
          })}
        </Body>
      </View>
    </>
  );
}
