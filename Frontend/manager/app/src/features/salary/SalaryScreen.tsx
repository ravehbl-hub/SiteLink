/**
 * Salary calculate + breakdown (FR-MGR-SRE). Posts /salary/calculate with worker +
 * period; the mode/rate are resolved server-side (never sent by the client). Renders
 * gross + itemized breakdown from SalaryResult.
 */
import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { SalaryResult, Worker, WorkingHours } from '@sitelink/shared';
import { endpoints } from '../../lib/endpoints';
import { qk } from '../../lib/queryKeys';
import { currentMonthRange, money, shortDate } from '../../lib/format';
import { ApiError } from '../../lib/api';
import {
  Body,
  Button,
  Card,
  EmptyState,
  Loading,
  Row,
  Screen,
  SectionHeading,
  Segmented,
  StatusPill,
  Title,
} from '../../components/ui';

/** Semantic tone + i18n label per derived day type (reuses attendance semantics). */
type DayType = 'ATTENDANCE' | 'VACATION' | 'DISEASE';

const DAY_TONE: Record<DayType, 'success' | 'info' | 'warning'> = {
  ATTENDANCE: 'success',
  VACATION: 'info',
  DISEASE: 'warning',
};

const DAY_LABEL_KEY: Record<DayType, string> = {
  ATTENDANCE: 'salary.typeAttendance',
  VACATION: 'salary.typeVacation',
  DISEASE: 'salary.typeDisease',
};

/** Derive the exclusive day type from the per-DAY WorkingHours aggregate. */
function dayType(wh: WorkingHours): DayType {
  if (wh.vacationDays === 1) return 'VACATION';
  if (wh.diseaseDays === 1) return 'DISEASE';
  return 'ATTENDANCE';
}

export function SalaryScreen() {
  const { t } = useTranslation();
  const [workerId, setWorkerId] = useState<string | null>(null);
  const [result, setResult] = useState<SalaryResult | null>(null);
  /** Worker the current `result` was computed for — pins the working-hours query. */
  const [resultWorkerId, setResultWorkerId] = useState<string | null>(null);
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
    onSuccess: (r) => {
      setResult(r);
      setResultWorkerId(workerId);
    },
    onError: (e) => Alert.alert(t('common.error'), e instanceof ApiError ? e.message : String(e)),
  });

  // Working-hours aggregate for the calculated worker+period (per-DAY grain).
  // Reconciles with the salary: sum(totalHours) == the salary's attendance hours,
  // since both derive from the same AttendanceRecord source. See /working-hours.
  const whParams = {
    workerId: resultWorkerId ?? undefined,
    from: range.from,
    to: range.to,
    grain: 'DAY' as const,
  };
  const whQ = useQuery({
    queryKey: qk.workingHours(whParams),
    queryFn: () => endpoints.workingHours(whParams),
    enabled: Boolean(result && resultWorkerId),
  });

  const whDays = React.useMemo(() => {
    const rows = whQ.data ?? [];
    return [...rows].sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  }, [whQ.data]);
  const whTotal = React.useMemo(
    () => whDays.reduce((sum, d) => sum + (d.totalHours ?? 0), 0),
    [whDays],
  );

  /** Per-day line total = hours × hourlyWage for ATTENDANCE only (vacation/disease → 0). */
  const rate = result?.hourlyWage ?? 0;
  const lineTotal = React.useCallback(
    (d: WorkingHours): number =>
      dayType(d) === 'ATTENDANCE' ? (d.totalHours ?? 0) * rate : 0,
    [rate],
  );
  const moneyTotal = React.useMemo(
    () => whDays.reduce((sum, d) => sum + lineTotal(d), 0),
    [whDays, lineTotal],
  );
  /**
   * Flat hourly reconciles: sum(hours × hourlyWage) === gross. For a fixed-monthly
   * calc (or any mismatch) the rate is informational and gross stays authoritative.
   * Detect by the AMOUNT MATCH only — NOT result.mode: FlatSalaryStrategy stamps
   * mode:'fixed' for BOTH the hourly and monthly paths (no distinct 'hourly' mode),
   * so a mode check would wrongly flag the common flat-hourly case as non-reconciling.
   */
  const reconciles = result != null && Math.abs(moneyTotal - result.gross) < 0.01;

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
        <Card glow>
          <Row style={{ justifyContent: 'space-between' }}>
            <SectionHeading>{t('salary.gross')}</SectionHeading>
            <Body tabular>{money(result.gross, result.currency)}</Body>
          </Row>
          <SectionHeading>{t('salary.breakdown')}</SectionHeading>
          {result.breakdown.map((line, i) => (
            <Row key={`${line.label}-${i}`} style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
              <Body muted>{line.label}</Body>
              <Body tabular>{money(line.amount, result.currency)}</Body>
            </Row>
          ))}
        </Card>
      ) : (
        <EmptyState label={t('salary.noResult')} />
      )}

      {result ? (
        <Card>
          <SectionHeading>{t('salary.workingHoursTitle')}</SectionHeading>

          {/* Hourly rate — the exact rate the calc used (result.hourlyWage). */}
          <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
            <Body muted>{t('salary.hourlyRate')}</Body>
            <Body tabular>{money(result.hourlyWage, result.currency)}</Body>
          </Row>

          {whQ.isLoading ? (
            <Loading />
          ) : whDays.length === 0 ? (
            <EmptyState label={t('salary.noWorkingHours')} />
          ) : (
            <View>
              {/* Column header: DATE | HOURS | TYPE | LINE TOTAL */}
              <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
                <View style={{ flex: 1 }}>
                  <Body muted>{t('salary.date')}</Body>
                </View>
                <View style={{ width: 48 }}>
                  <Body muted tabular>
                    {t('salary.hours')}
                  </Body>
                </View>
                <View style={{ width: 76 }}>
                  <Body muted>{t('salary.type')}</Body>
                </View>
                <View style={{ width: 84, alignItems: 'flex-end' }}>
                  <Body muted tabular>
                    {t('salary.lineTotal')}
                  </Body>
                </View>
              </Row>

              {whDays.map((d) => {
                const dt = dayType(d);
                const lt = lineTotal(d);
                return (
                  <Row
                    key={d.periodStart}
                    style={{ justifyContent: 'space-between', paddingVertical: 4 }}
                  >
                    <View style={{ flex: 1 }}>
                      <Body>{shortDate(d.periodStart)}</Body>
                    </View>
                    <View style={{ width: 48 }}>
                      <Body tabular>{d.totalHours}</Body>
                    </View>
                    <View style={{ width: 76 }}>
                      <StatusPill label={t(DAY_LABEL_KEY[dt])} tone={DAY_TONE[dt]} />
                    </View>
                    <View style={{ width: 84, alignItems: 'flex-end' }}>
                      <Body tabular muted={dt !== 'ATTENDANCE'}>
                        {dt === 'ATTENDANCE' ? money(lt, result.currency) : '—'}
                      </Body>
                    </View>
                  </Row>
                );
              })}

              {/* Total row — hours total reconciles with the salary's attendance hours. */}
              <View style={{ height: 8 }} />
              <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
                <SectionHeading>{t('salary.total')}</SectionHeading>
                <Body tabular>
                  {whTotal} {t('salary.hours')}
                </Body>
              </Row>

              {/* Money total = sum(line totals). Flat hourly → equals result.gross. */}
              <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
                <Body muted>{t('salary.moneyTotal')}</Body>
                <Body tabular>{money(moneyTotal, result.currency)}</Body>
              </Row>

              {/* Fixed-monthly / mismatch: rate is informational, gross authoritative. */}
              {!reconciles ? (
                <View style={{ paddingTop: 4 }}>
                  <Body muted>{t('salary.rateInformational')}</Body>
                </View>
              ) : null}
            </View>
          )}
        </Card>
      ) : null}
    </Screen>
  );
}
