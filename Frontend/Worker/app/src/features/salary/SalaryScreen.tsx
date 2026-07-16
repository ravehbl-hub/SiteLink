/**
 * Salary (FR-WRK-2). Self-forced: POST /salary/calculate {periodStart, periodEnd}
 * (no workerId — the back end forces the caller's own worker). Renders gross/net/
 * period metrics + the itemized breakdown, and a Payslip PDF button →
 * GET /reports/payslip.pdf?from&to&lang.
 */
import React, { useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { SalaryResult } from '@sitelink/shared';
import { endpoints } from '../../lib/endpoints';
import { currentMonthRange, money, shortDate } from '../../lib/format';
import { exportPayslipPdf } from '../../lib/pdf';
import { ApiError } from '../../lib/api';
import { toLocale } from '../../i18n';
import { useTheme } from '../../theme/ThemeProvider';
import {
  Body,
  Button,
  Card,
  EmptyState,
  Metric,
  Row,
  Screen,
  SectionHeading,
  Title,
} from '../../components/ui';

/** Net = gross minus the sum of negative breakdown lines (deductions). */
function computeNet(result: SalaryResult): number {
  const deductions = result.breakdown
    .filter((line) => line.amount < 0)
    .reduce((sum, line) => sum + line.amount, 0);
  return result.gross + deductions;
}

export function SalaryScreen() {
  const { t } = useTranslation();
  const { language } = useTheme();
  const [result, setResult] = useState<SalaryResult | null>(null);
  const [exporting, setExporting] = useState(false);
  const range = useMemo(currentMonthRange, []);

  const calcMut = useMutation({
    mutationFn: () =>
      endpoints.calculateSalary({ periodStart: range.from, periodEnd: range.to }),
    onSuccess: (r) => setResult(r),
    onError: (e) => Alert.alert(t('common.error'), e instanceof ApiError ? e.message : String(e)),
  });

  async function onPayslip() {
    setExporting(true);
    try {
      await exportPayslipPdf({ from: range.from, to: range.to, lang: toLocale(language) });
    } catch (e) {
      Alert.alert(t('common.error'), e instanceof ApiError ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <Screen>
      <Title>{t('salary.title')}</Title>

      <Card>
        <SectionHeading>{t('salary.period')}</SectionHeading>
        <Body muted>
          {shortDate(range.from)} – {shortDate(range.to)}
        </Body>
        <View style={{ height: 8 }} />
        <Button
          title={t('salary.calculate')}
          onPress={() => calcMut.mutate()}
          loading={calcMut.isPending}
        />
        <Button
          title={exporting ? t('common.loading') : t('salary.payslipPdf')}
          variant="secondary"
          onPress={onPayslip}
          loading={exporting}
        />
      </Card>

      {result ? (
        <>
          <Card glow>
            <Row style={{ justifyContent: 'space-between' }}>
              <Metric label={t('salary.gross')} value={money(result.gross, result.currency)} />
              <Metric
                label={t('salary.net')}
                value={money(computeNet(result), result.currency)}
              />
            </Row>
            <Metric
              label={t('salary.period')}
              value={`${shortDate(range.from)} – ${shortDate(range.to)}`}
            />
          </Card>

          <Card>
            <SectionHeading>{t('salary.breakdown')}</SectionHeading>
            {result.breakdown.map((line, i) => (
              <Row
                key={`${line.label}-${i}`}
                style={{ justifyContent: 'space-between', paddingVertical: 4 }}
              >
                <Body muted>{line.label}</Body>
                <Body numeric>{money(line.amount, result.currency)}</Body>
              </Row>
            ))}
            <View style={{ height: 8 }} />
            <Body muted>
              {t('salary.engineVersion')}: {result.engineVersion}
            </Body>
          </Card>
        </>
      ) : (
        <EmptyState label={t('salary.noResult')} />
      )}
    </Screen>
  );
}
