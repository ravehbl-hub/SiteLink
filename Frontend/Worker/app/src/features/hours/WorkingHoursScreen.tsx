/**
 * Working Hours (FR-WRK-1). Self-scoped: GET /working-hours?from&to&grain returns
 * the caller's OWN aggregates (no workerId sent). Grain is chosen via a Segmented
 * control (Day/Week/Month). Renders cards per bucket + a BarChart of hours, and an
 * Export PDF button → GET /reports/working-hours.pdf?from&to&grain&lang.
 */
import React, { useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { WorkingHours } from '@sitelink/shared';
import { endpoints, type WorkingHoursGrainParam } from '../../lib/endpoints';
import { qk } from '../../lib/queryKeys';
import { currentMonthRange, shortDate } from '../../lib/format';
import { exportWorkingHoursPdf } from '../../lib/pdf';
import { ApiError } from '../../lib/api';
import { toLocale } from '../../i18n';
import { useTheme } from '../../theme/ThemeProvider';
import {
  Body,
  Button,
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
import { BarChart } from '../../components/charts';

export function WorkingHoursScreen() {
  const { t } = useTranslation();
  const { language } = useTheme();
  const [grain, setGrain] = useState<WorkingHoursGrainParam>('week');
  const [exporting, setExporting] = useState(false);
  const range = useMemo(currentMonthRange, []);

  const params = { from: range.from, to: range.to, grain };
  const q = useQuery({
    queryKey: qk.workingHours(params),
    queryFn: () => endpoints.workingHours(params),
  });

  const rows = (q.data ?? []) as WorkingHours[];
  const totalHours = rows.reduce((sum, r) => sum + r.totalHours, 0);
  const chartData = rows.map((r) => ({
    label: shortDate(r.periodStart),
    value: Math.round(r.totalHours),
  }));

  async function onExport() {
    setExporting(true);
    try {
      await exportWorkingHoursPdf({
        from: range.from,
        to: range.to,
        grain,
        lang: toLocale(language),
      });
    } catch (e) {
      Alert.alert(t('common.error'), e instanceof ApiError ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <Screen>
      <Title>{t('workingHours.title')}</Title>

      <Card>
        <SectionHeading>{t('workingHours.grain')}</SectionHeading>
        <Segmented
          options={[
            { value: 'day', label: t('workingHours.grainDay') },
            { value: 'week', label: t('workingHours.grainWeek') },
            { value: 'month', label: t('workingHours.grainMonth') },
          ]}
          value={grain}
          onChange={setGrain}
        />
        <Row style={{ justifyContent: 'space-between' }}>
          <Metric label={t('workingHours.totalHours')} value={Math.round(totalHours)} />
          <Metric label={t('workingHours.buckets')} value={rows.length} />
        </Row>
        <Button
          title={exporting ? t('common.loading') : t('workingHours.exportPdf')}
          variant="secondary"
          onPress={onExport}
          loading={exporting}
        />
      </Card>

      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState label={t('common.loadFailed')} onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState label={t('workingHours.empty')} />
      ) : (
        <>
          {chartData.length > 0 ? (
            <Card>
              <SectionHeading>{t('workingHours.chartTitle')}</SectionHeading>
              <BarChart data={chartData} />
            </Card>
          ) : null}

          {rows.map((r, i) => (
            <Card key={`${r.periodStart}-${i}`}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Body>
                  {shortDate(r.periodStart)} – {shortDate(r.periodEnd)}
                </Body>
                <Body>{t('workingHours.hoursValue', { hours: Math.round(r.totalHours) })}</Body>
              </Row>
              <Row style={{ justifyContent: 'space-between', paddingVertical: 2 }}>
                <Body muted>{t('workingHours.attendanceDays')}</Body>
                <Body muted>{r.attendanceDays}</Body>
              </Row>
              <Row style={{ justifyContent: 'space-between', paddingVertical: 2 }}>
                <Body muted>{t('workingHours.vacationDays')}</Body>
                <Body muted>{r.vacationDays}</Body>
              </Row>
              <Row style={{ justifyContent: 'space-between', paddingVertical: 2 }}>
                <Body muted>{t('workingHours.diseaseDays')}</Body>
                <Body muted>{r.diseaseDays}</Body>
              </Row>
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}
