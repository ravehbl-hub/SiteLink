/**
 * Salary calculate + breakdown (FR-MGR-SRE). Posts /salary/calculate with worker +
 * period; the mode/rate are resolved server-side (never sent by the client). Renders
 * gross + itemized breakdown from SalaryResult.
 */
import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { SalaryResult, Worker } from '@sitelink/shared';
import { endpoints } from '../../lib/endpoints';
import { qk } from '../../lib/queryKeys';
import { currentMonthRange, money } from '../../lib/format';
import { ApiError } from '../../lib/api';
import {
  Body,
  Button,
  Card,
  EmptyState,
  Row,
  Screen,
  SectionHeading,
  Segmented,
  Title,
} from '../../components/ui';

export function SalaryScreen() {
  const { t } = useTranslation();
  const [workerId, setWorkerId] = useState<string | null>(null);
  const [result, setResult] = useState<SalaryResult | null>(null);
  const range = React.useMemo(currentMonthRange, []);

  const workersQ = useQuery({ queryKey: qk.workers(), queryFn: () => endpoints.listWorkers() });

  const calcMut = useMutation({
    mutationFn: () => {
      if (!workerId) throw new ApiError(0, 'NO_WORKER', 'Select a worker');
      return endpoints.calculateSalary({
        workerId,
        periodStart: range.from,
        periodEnd: range.to,
      });
    },
    onSuccess: (r) => setResult(r),
    onError: (e) => Alert.alert(t('common.error'), e instanceof ApiError ? e.message : String(e)),
  });

  const workerOptions = ((workersQ.data?.items ?? []) as Worker[]).map((w) => ({
    value: w.id,
    label: `${w.firstName} ${w.lastName}`,
  }));

  return (
    <Screen>
      <Title>{t('salary.title')}</Title>

      <Card>
        <SectionHeading>{t('salary.selectWorker')}</SectionHeading>
        <Segmented options={workerOptions} value={workerId} onChange={(v) => setWorkerId(v)} />
        <Button
          title={t('salary.calculate')}
          onPress={() => calcMut.mutate()}
          loading={calcMut.isPending}
          disabled={!workerId}
        />
      </Card>

      {result ? (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <SectionHeading>{t('salary.gross')}</SectionHeading>
            <Body>{money(result.gross, result.currency)}</Body>
          </Row>
          <SectionHeading>{t('salary.breakdown')}</SectionHeading>
          {result.breakdown.map((line, i) => (
            <Row key={`${line.label}-${i}`} style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
              <Body muted>{line.label}</Body>
              <Body>{money(line.amount, result.currency)}</Body>
            </Row>
          ))}
          <View style={{ height: 8 }} />
          <Body muted>
            {t('salary.engineVersion')}: {result.engineVersion}
          </Body>
        </Card>
      ) : (
        <EmptyState label={t('salary.noResult')} />
      )}
    </Screen>
  );
}
