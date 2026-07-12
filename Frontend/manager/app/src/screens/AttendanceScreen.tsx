/**
 * Attendance / Vacation / Disease + Working Hours (FR-MGR-ATT). Log an entry
 * (exclusive type per worker/day) and view recent records. Semantic colors per
 * DESIGN.md: present=success, vacation=info, disease=warning.
 */
import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AttendanceType, type Worker } from '@sitelink/shared';
import { endpoints } from '../lib/endpoints';
import { qk } from '../lib/queryKeys';
import { currentMonthRange, shortDate } from '../lib/format';
import { ApiError } from '../lib/api';
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
} from '../components/ui';

const TONE: Record<AttendanceType, 'success' | 'info' | 'warning'> = {
  [AttendanceType.ATTENDANCE]: 'success',
  [AttendanceType.VACATION]: 'info',
  [AttendanceType.DISEASE]: 'warning',
};

const TYPE_LABEL_KEY: Record<AttendanceType, string> = {
  [AttendanceType.ATTENDANCE]: 'attendance.present',
  [AttendanceType.VACATION]: 'attendance.vacation',
  [AttendanceType.DISEASE]: 'attendance.disease',
};

export function AttendanceScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const range = React.useMemo(currentMonthRange, []);

  const [workerId, setWorkerId] = useState<string | null>(null);
  const [type, setType] = useState<AttendanceType>(AttendanceType.ATTENDANCE);
  const [hours, setHours] = useState('8');

  const workersQ = useQuery({
    queryKey: qk.workers(),
    queryFn: () => endpoints.listWorkers(),
  });

  const params = { workerId: workerId ?? undefined, from: range.from, to: range.to };
  const attQ = useQuery({
    queryKey: qk.attendance(params),
    queryFn: () => endpoints.listAttendance(params),
  });

  const createMut = useMutation({
    mutationFn: () => {
      if (!workerId) throw new ApiError(0, 'NO_WORKER', 'Select a worker');
      return endpoints.createAttendance({
        workerId,
        date: new Date().toISOString(),
        type,
        hours: type === AttendanceType.ATTENDANCE ? Number(hours) : null,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['attendance'] }),
    onError: (e) => Alert.alert(t('common.error'), e instanceof ApiError ? e.message : String(e)),
  });

  const workerOptions = ((workersQ.data?.items ?? []) as Worker[]).map((w) => ({
    value: w.id,
    label: `${w.firstName} ${w.lastName}`,
  }));

  return (
    <Screen>
      <Title>{t('attendance.title')}</Title>

      <Card>
        <SectionHeading>{t('attendance.logEntry')}</SectionHeading>
        <SectionHeading>{t('attendance.worker')}</SectionHeading>
        <Segmented options={workerOptions} value={workerId} onChange={(v) => setWorkerId(v)} />

        <SectionHeading>{t('attendance.type')}</SectionHeading>
        <Segmented
          options={[
            { value: AttendanceType.ATTENDANCE, label: t('attendance.present') },
            { value: AttendanceType.VACATION, label: t('attendance.vacation') },
            { value: AttendanceType.DISEASE, label: t('attendance.disease') },
          ]}
          value={type}
          onChange={(v) => setType(v)}
        />
        {type === AttendanceType.ATTENDANCE ? (
          <Field
            label={t('attendance.hours')}
            value={hours}
            onChangeText={setHours}
            keyboardType="numeric"
          />
        ) : null}
        <Button
          title={t('common.save')}
          onPress={() => createMut.mutate()}
          loading={createMut.isPending}
          disabled={!workerId}
        />
      </Card>

      <SectionHeading>{t('attendance.workingHours')}</SectionHeading>
      {attQ.isLoading ? (
        <Loading />
      ) : !attQ.data || attQ.data.length === 0 ? (
        <EmptyState label={t('attendance.noRecords')} />
      ) : (
        attQ.data.map((r) => (
          <Card key={r.id}>
            <Row style={{ justifyContent: 'space-between' }}>
              <View>
                <Body>{shortDate(r.date)}</Body>
                <Body muted>
                  {r.hours != null ? `${r.hours} ${t('attendance.hours')}` : '—'}
                </Body>
              </View>
              <StatusPill label={t(TYPE_LABEL_KEY[r.type])} tone={TONE[r.type]} />
            </Row>
          </Card>
        ))
      )}
    </Screen>
  );
}
