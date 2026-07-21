/**
 * Salary calculate + breakdown (FR-MGR-SRE). Posts /salary/calculate with worker +
 * period; the mode/rate are resolved server-side (never sent by the client). Renders
 * gross + itemized breakdown from SalaryResult.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Switch, View } from 'react-native';
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
  Field,
  Loading,
  Row,
  Screen,
  SectionHeading,
  Segmented,
  StatusPill,
  Title,
} from '../../components/ui';
import { useTheme } from '../../theme/ThemeProvider';

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
  const { theme } = useTheme();
  const [workerId, setWorkerId] = useState<string | null>(null);
  const [result, setResult] = useState<SalaryResult | null>(null);
  /** Worker the current `result` was computed for — pins the working-hours query. */
  const [resultWorkerId, setResultWorkerId] = useState<string | null>(null);
  const range = React.useMemo(currentMonthRange, []);

  // HOURS-SPLIT payment (default OFF → the calc/screen stay byte-for-byte the
  // pre-split behaviour, no split params sent). When ON, threshold (default 236)
  // + a REQUIRED contractor rate reveal. Strings so the fields can be blank.
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splitThreshold, setSplitThreshold] = useState('236');
  const [contractorRate, setContractorRate] = useState('');
  // Guard: split ON but no contractor rate → backend would 400. Disable Calculate.
  const contractorRateMissing = splitEnabled && contractorRate.trim() === '';
  // Whether the split was just auto-opened (≥236 attendance) — shows a one-off hint.
  const [autoOpened, setAutoOpened] = useState(false);
  // Last worker+period the auto-open fired for, so it triggers once per crossing
  // and never re-enables after the manager manually turns split back off.
  const autoOpenedForRef = useRef<string | null>(null);

  const workersQ = useQuery({ queryKey: qk.workers(), queryFn: () => endpoints.listWorkers() });

  const calcMut = useMutation({
    mutationFn: () => {
      if (!workerId) throw new ApiError(0, 'NO_WORKER', 'Select a worker');
      // Only attach split params when ENABLED; otherwise send the plain body so
      // the calc stays identical to the pre-split behaviour. threshold falls back
      // to the backend default (236) if left blank.
      const body: Parameters<typeof endpoints.calculateSalary>[0] = {
        workerId,
        periodStart: range.from,
        periodEnd: range.to,
      };
      if (splitEnabled) {
        body.splitEnabled = true;
        const thr = Number(splitThreshold);
        if (splitThreshold.trim() !== '' && Number.isFinite(thr)) {
          body.splitThreshold = thr;
        }
        const cr = Number(contractorRate);
        if (contractorRate.trim() !== '' && Number.isFinite(cr)) {
          body.contractorRate = cr;
        }
      }
      return endpoints.calculateSalary(body);
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
  // ATTENDANCE-only hours (vacation/disease excluded) — the figure the split
  // threshold is measured against. Drives the ≥236 auto-open below.
  const attendanceHours = React.useMemo(
    () =>
      whDays.reduce(
        (sum, d) => sum + (dayType(d) === 'ATTENDANCE' ? d.totalHours ?? 0 : 0),
        0,
      ),
    [whDays],
  );

  // AUTO-OPEN (Option A): once the working-hours have loaded for the freshly
  // computed worker+period, if ATTENDANCE hours strictly exceed 236 and split
  // is not already on, auto-enable it and pre-fill the threshold to 236 (the
  // contractor rate stays blank — the manager types it; the disabled-Calculate
  // guard keeps it honest). Fires ONCE per worker+period crossing (tracked in a
  // ref) so it never re-enables after the manager manually turns split back off.
  useEffect(() => {
    if (!result || !resultWorkerId || whQ.isLoading || whDays.length === 0) return;
    const crossingKey = `${resultWorkerId}:${range.from}:${range.to}`;
    if (autoOpenedForRef.current === crossingKey) return;
    if (attendanceHours > 236) {
      autoOpenedForRef.current = crossingKey;
      if (!splitEnabled) {
        setSplitEnabled(true);
        setSplitThreshold('236');
        setAutoOpened(true);
      }
    }
  }, [
    result,
    resultWorkerId,
    whQ.isLoading,
    whDays.length,
    attendanceHours,
    splitEnabled,
    range.from,
    range.to,
  ]);

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

        {/* HOURS-SPLIT controls: a toggle (default OFF) that reveals a threshold
            (default 236) + a REQUIRED contractor rate, side-by-side on one row.
            RTL-safe: logical layout + textAlign:'auto' inherited from Field. */}
        <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
          <Body muted>{t('salary.splitToggle')}</Body>
          <Switch
            value={splitEnabled}
            onValueChange={(v) => {
              setSplitEnabled(v);
              // Manual toggle clears the auto-open hint; turning it off here also
              // stops the effect re-enabling it (crossingKey already recorded).
              if (!v) setAutoOpened(false);
            }}
            trackColor={{ true: theme.colors.accent, false: theme.colors.border }}
            thumbColor={theme.colors.surface}
          />
        </Row>

        {splitEnabled ? (
          <>
            {autoOpened ? (
              <Body muted>{t('salary.splitAutoOpened')}</Body>
            ) : null}
            <Row style={{ alignItems: 'flex-start' }}>
              <View style={{ flex: 1, marginEnd: 8 }}>
                <Field
                  label={t('salary.splitThreshold')}
                  value={splitThreshold}
                  onChangeText={setSplitThreshold}
                  keyboardType="numeric"
                  inputMode="numeric"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label={t('salary.splitContractorRate')}
                  value={contractorRate}
                  onChangeText={setContractorRate}
                  keyboardType="decimal-pad"
                  inputMode="decimal"
                />
                {contractorRateMissing ? (
                  <Body muted>{t('salary.splitContractorRateRequired')}</Body>
                ) : null}
              </View>
            </Row>
          </>
        ) : null}

        <Button
          title={t('salary.calculate')}
          onPress={() => calcMut.mutate()}
          loading={calcMut.isPending}
          disabled={!workerId || contractorRateMissing}
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

          {/* HOURS-SPLIT breakdown: rendered only when the calc ran with split
              enabled (result.split?.enabled). Personnel line (hours × personnel
              rate) + Contractor line + the combined total, which equals gross.
              Columns: label | hours | rate | amount, figures aligned to the end. */}
          {result.split?.enabled ? (
            <View style={{ marginTop: 8 }}>
              <SectionHeading>{t('salary.splitTitle')}</SectionHeading>

              {/* Column header: label | HOURS | RATE | AMOUNT */}
              <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
                <View style={{ flex: 1 }} />
                <View style={{ width: 48, alignItems: 'flex-end' }}>
                  <Body muted tabular>{t('salary.splitHours')}</Body>
                </View>
                <View style={{ width: 72, alignItems: 'flex-end' }}>
                  <Body muted tabular>{t('salary.splitRate')}</Body>
                </View>
                <View style={{ width: 84, alignItems: 'flex-end' }}>
                  <Body muted tabular>{t('salary.splitAmount')}</Body>
                </View>
              </Row>

              {/* Personnel portion — min(hours, threshold) × personnel rate. */}
              <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
                <View style={{ flex: 1 }}>
                  <Body>{t('salary.splitPersonnel')}</Body>
                </View>
                <View style={{ width: 48, alignItems: 'flex-end' }}>
                  <Body tabular>{result.split.personnelHours}</Body>
                </View>
                <View style={{ width: 72, alignItems: 'flex-end' }}>
                  <Body tabular>{money(result.split.personnelRate, result.currency)}</Body>
                </View>
                <View style={{ width: 84, alignItems: 'flex-end' }}>
                  <Body tabular>{money(result.split.personnelAmount, result.currency)}</Body>
                </View>
              </Row>

              {/* Contractor portion — max(0, hours − threshold) × contractor rate. */}
              <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
                <View style={{ flex: 1 }}>
                  <Body>{t('salary.splitContractor')}</Body>
                </View>
                <View style={{ width: 48, alignItems: 'flex-end' }}>
                  <Body tabular>{result.split.contractorHours}</Body>
                </View>
                <View style={{ width: 72, alignItems: 'flex-end' }}>
                  <Body tabular>{money(result.split.contractorRate, result.currency)}</Body>
                </View>
                <View style={{ width: 84, alignItems: 'flex-end' }}>
                  <Body tabular>{money(result.split.contractorAmount, result.currency)}</Body>
                </View>
              </Row>

              {/* Total — combined hours + amount; amount equals result.gross. */}
              <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
                <View style={{ flex: 1 }}>
                  <SectionHeading>{t('salary.splitTotal')}</SectionHeading>
                </View>
                <View style={{ width: 48, alignItems: 'flex-end' }}>
                  <Body tabular>
                    {result.split.personnelHours + result.split.contractorHours}
                  </Body>
                </View>
                <View style={{ width: 72 }} />
                <View style={{ width: 84, alignItems: 'flex-end' }}>
                  <Body tabular>
                    {money(
                      result.split.personnelAmount + result.split.contractorAmount,
                      result.currency,
                    )}
                  </Body>
                </View>
              </Row>
            </View>
          ) : null}
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
