/**
 * Attendance / Vacation / Disease (FR-FOR-4). The Foreman logs an entry for a
 * worker on their ACTIVE selected site. Worker picker is limited to that site's
 * workers (GET /workers?siteId=activeSiteId). For a MULTI-SITE foreman the back end
 * requires a concrete siteId (it will not guess), so we pass siteId=activeSiteId on
 * the create; the server still validates it is inside the foreman's scope union.
 * Semantic colors (DESIGN.md): present=success, vacation=info, disease=warning.
 */
import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AttendanceType, type Worker } from '@sitelink/shared';
import { endpoints } from '../../lib/endpoints';
import { qk } from '../../lib/queryKeys';
import { live, POLL, STALE } from '../../lib/polling';
import { currentMonthRange, shortDate } from '../../lib/format';
import { ApiError } from '../../lib/api';
import { useActiveSite } from '../../site/ActiveSiteProvider';
import { SitePicker } from '../../site/SitePicker';
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
  const { activeSiteId, ready } = useActiveSite();
  const range = React.useMemo(currentMonthRange, []);

  const [workerId, setWorkerId] = useState<string | null>(null);
  const [type, setType] = useState<AttendanceType>(AttendanceType.ATTENDANCE);
  const [hours, setHours] = useState('8');

  const siteId = activeSiteId ?? undefined;

  const workersQ = useQuery({
    queryKey: qk.workers({ siteId }),
    queryFn: () => endpoints.listWorkers({ siteId }),
    enabled: Boolean(activeSiteId),
    staleTime: STALE.reference,
  });

  const params = { siteId, workerId: workerId ?? undefined, from: range.from, to: range.to };
  const attQ = useQuery({
    queryKey: qk.attendance(params),
    queryFn: () => endpoints.listAttendance(params),
    enabled: Boolean(activeSiteId),
    ...live(POLL.attendance, STALE.live),
  });

  const createMut = useMutation({
    mutationFn: () => {
      if (!workerId) throw new ApiError(0, 'NO_WORKER', 'Select a worker');
      return endpoints.createAttendance({
        workerId,
        // Server forces the Foreman's own site; passed for consistency.
        siteId,
        date: new Date().toISOString(),
        type,
        hours: type === AttendanceType.ATTENDANCE ? Number(hours) : null,
      });
    },
    // Attendance feeds the dashboard rollup — invalidate both so KPIs refresh.
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['attendance'] }),
        qc.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
    },
    onError: (e) => Alert.alert(t('common.error'), e instanceof ApiError ? e.message : String(e)),
  });

  // Switching sites invalidates the worker selection (workers are site-specific).
  React.useEffect(() => {
    setWorkerId(null);
  }, [activeSiteId]);

  if (!ready) {
    return (
      <Screen>
        <Title>{t('attendance.title')}</Title>
        <Loading label={t('site.loading')} />
      </Screen>
    );
  }

  if (!activeSiteId) {
    return (
      <Screen>
        <Title>{t('attendance.title')}</Title>
        <Card>
          <EmptyState label={t('common.noSiteAssigned')} />
        </Card>
      </Screen>
    );
  }

  const workerOptions = ((workersQ.data?.items ?? []) as Worker[]).map((w) => ({
    value: w.id,
    label: `${w.firstName} ${w.lastName}`,
  }));

  return (
    <Screen>
      <Title>{t('attendance.title')}</Title>
      <SitePicker />

      <Card>
        <SectionHeading>{t('attendance.logEntry')}</SectionHeading>
        <SectionHeading>{t('attendance.worker')}</SectionHeading>
        {workersQ.isLoading ? (
          <Loading />
        ) : workerOptions.length === 0 ? (
          <EmptyState label={t('attendance.noWorkers')} />
        ) : (
          <Segmented options={workerOptions} value={workerId} onChange={(v) => setWorkerId(v)} />
        )}

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

      <SectionHeading>{t('attendance.records')}</SectionHeading>
      {attQ.isLoading ? (
        <Loading />
      ) : !attQ.data || attQ.data.items.length === 0 ? (
        <EmptyState label={t('attendance.noRecords')} />
      ) : (
        attQ.data.items.map((r) => (
          <Card key={r.id}>
            <Row style={{ justifyContent: 'space-between' }}>
              <View>
                <Body numeric>{shortDate(r.date)}</Body>
                <Body muted numeric>{r.hours != null ? `${r.hours} ${t('attendance.hours')}` : '—'}</Body>
              </View>
              <StatusPill label={t(TYPE_LABEL_KEY[r.type])} tone={TONE[r.type]} />
            </Row>
          </Card>
        ))
      )}
    </Screen>
  );
}
