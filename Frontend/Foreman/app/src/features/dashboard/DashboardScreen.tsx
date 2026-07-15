/**
 * Site Dashboard (FR-FOR-2). Consumes GET /dashboard?siteId={activeSiteId}&from&to
 * → DashboardRollup, scoped to the Foreman's ACTIVE selected site (multi-site picker;
 * the back end validates the id is in the foreman's scope union, else 403).
 * Date filter is a Segmented preset (All / Today / Week / Month). Renders KPI
 * Metrics plus an attendance-split DonutChart and a per-status BarChart.
 * States: no-site-assigned · loading · error · empty · data.
 */
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../lib/endpoints';
import { qk } from '../../lib/queryKeys';
import { presetRange, type DatePreset } from '../../lib/format';
import { useActiveSite } from '../../site/ActiveSiteProvider';
import { SitePicker } from '../../site/SitePicker';
import { useTheme } from '../../theme/ThemeProvider';
import { DonutChart, BarChart } from '../../components/charts';
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

export function DashboardScreen() {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { activeSiteId, ready } = useActiveSite();
  const [preset, setPreset] = useState<DatePreset>('month');

  const range = useMemo(() => presetRange(preset), [preset]);
  const params = { siteId: activeSiteId ?? undefined, from: range.from, to: range.to };

  const dashQ = useQuery({
    queryKey: qk.dashboard(params),
    queryFn: () => endpoints.dashboard(params),
    enabled: Boolean(activeSiteId),
  });

  if (!ready) {
    return (
      <Screen>
        <Title>{t('dashboard.title')}</Title>
        <Loading label={t('site.loading')} />
      </Screen>
    );
  }

  if (!activeSiteId) {
    return (
      <Screen>
        <Title>{t('dashboard.title')}</Title>
        <Card>
          <EmptyState label={t('common.noSiteAssigned')} />
        </Card>
      </Screen>
    );
  }

  const w = dashQ.data?.workers;
  const attendanceSplit = w
    ? [
        { label: t('attendance.present'), value: w.attendanceDays, color: theme.colors.success },
        { label: t('attendance.vacation'), value: w.vacationDays, color: theme.colors.info },
        { label: t('attendance.disease'), value: w.diseaseDays, color: theme.colors.warning },
      ]
    : [];

  return (
    <Screen>
      <Title>{t('dashboard.title')}</Title>
      <SitePicker />

      <SectionHeading>{t('dashboard.dateRange')}</SectionHeading>
      <Segmented
        options={[
          { value: 'all', label: t('dashboard.all') },
          { value: 'today', label: t('dashboard.today') },
          { value: 'week', label: t('dashboard.week') },
          { value: 'month', label: t('dashboard.month') },
        ]}
        value={preset}
        onChange={(v) => setPreset(v as DatePreset)}
      />

      {dashQ.isLoading ? (
        <Loading label={t('common.loading')} />
      ) : dashQ.isError ? (
        <ErrorState label={t('common.error')} onRetry={() => dashQ.refetch()} />
      ) : w ? (
        <>
          <Card>
            <SectionHeading>{t('dashboard.workforce')}</SectionHeading>
            <Row style={{ justifyContent: 'space-between' }}>
              <Metric label={t('dashboard.workers')} value={w.amountOfWorkers} />
              <Metric label={t('dashboard.totalHours')} value={w.totalWorkHours} />
              <Metric label={t('dashboard.attendanceDays')} value={w.attendanceDays} />
              <Metric label={t('dashboard.vacationDays')} value={w.vacationDays} />
              <Metric label={t('dashboard.diseaseDays')} value={w.diseaseDays} />
            </Row>
          </Card>

          <Card>
            <SectionHeading>{t('dashboard.attendanceSplit')}</SectionHeading>
            <DonutChart data={attendanceSplit} />
          </Card>

          <Card>
            <SectionHeading>{t('dashboard.attendanceBars')}</SectionHeading>
            <BarChart data={attendanceSplit} />
          </Card>

          {dashQ.data ? (
            <View style={{ paddingVertical: 8 }}>
              <Body muted>
                {t('dashboard.computedAt', {
                  time: new Date(dashQ.data.computedAt).toLocaleString(),
                })}
              </Body>
            </View>
          ) : null}
        </>
      ) : (
        <EmptyState label={t('dashboard.emptyState')} />
      )}
      <View style={{ height: Number(theme.tokens.spacing['8']) }} />
    </Screen>
  );
}
