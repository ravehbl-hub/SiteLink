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
import { useTheme } from '../../theme/ThemeProvider';
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
  Select,
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

/** Current local time as "HH:MM" (zero-padded). */
function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "HH:MM" + today's date → ISO timestamp. Blank/invalid → null (not recorded). */
function timeToISO(hhmm: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const d = new Date();
  d.setHours(h, min, 0, 0);
  return d.toISOString();
}

export function AttendanceScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { activeSiteId, ready } = useActiveSite();
  const range = React.useMemo(currentMonthRange, []);

  const { theme } = useTheme();
  const [workerId, setWorkerId] = useState<string | null>(null);
  const [type, setType] = useState<AttendanceType>(AttendanceType.ATTENDANCE);
  const [hours, setHours] = useState('8');
  // Clock in/out — entered as "HH:MM" (or stamped via the buttons); combined with
  // today's date into an ISO timestamp on save. Optional (blank = not recorded).
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  // Session status per worker: 'in' after a check-in click, 'out' after check-out —
  // used to color the worker in the picker (color 1 = checked in, color 2 = checked out).
  const [statusByWorker, setStatusByWorker] = useState<Record<string, 'in' | 'out'>>({});

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

  // One attendance record per worker/day (server @@unique). Find today's record for
  // the picked worker so a second save/clock UPDATES it instead of 409-conflicting.
  const todayISO = new Date().toISOString().slice(0, 10);
  const existingToday =
    workerId != null
      ? attQ.data?.items.find(
          (r) => r.workerId === workerId && String(r.date).slice(0, 10) === todayISO,
        )
      : undefined;

  const createMut = useMutation({
    mutationFn: () => {
      if (!workerId) throw new ApiError(0, 'NO_WORKER', 'Select a worker');
      const body = {
        type,
        hours: type === AttendanceType.ATTENDANCE ? Number(hours) : null,
        // Clock in/out only for a present (ATTENDANCE) entry; blank → null.
        checkIn: type === AttendanceType.ATTENDANCE ? timeToISO(checkIn) : null,
        checkOut: type === AttendanceType.ATTENDANCE ? timeToISO(checkOut) : null,
      };
      // UPSERT: update today's existing record, else create a new one.
      if (existingToday) {
        return endpoints.updateAttendance(existingToday.id, body);
      }
      return endpoints.createAttendance({
        workerId,
        // Server forces the Foreman's own site; passed for consistency.
        siteId,
        date: new Date().toISOString(),
        ...body,
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

  const workerOptions = ((workersQ.data?.items ?? []) as Worker[]).map((w) => {
    const st = statusByWorker[w.id];
    return {
      value: w.id,
      label: `${w.firstName} ${w.lastName}`,
      // color 1 = checked in (warning/amber), color 2 = checked out (success/green).
      color:
        st === 'in' ? theme.colors.warning : st === 'out' ? theme.colors.success : undefined,
    };
  });

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
          <Select
            options={workerOptions}
            value={workerId}
            onChange={(v) => {
              setWorkerId(v);
              // Fresh entry for the newly picked worker.
              setCheckIn('');
              setCheckOut('');
            }}
            placeholder={t('attendance.worker')}
          />
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
          <>
            <Field
              label={t('attendance.hours')}
              value={hours}
              onChangeText={setHours}
              keyboardType="numeric"
            />
            <Field
              label={t('attendance.checkIn')}
              value={checkIn}
              onChangeText={setCheckIn}
              placeholder="07:00"
            />
            <Button
              title={t('attendance.checkInNow')}
              onPress={() => {
                if (!workerId) return;
                setCheckIn(nowHHMM());
                setStatusByWorker((m) => ({ ...m, [workerId]: 'in' }));
              }}
              disabled={!workerId}
            />
            <Field
              label={t('attendance.checkOut')}
              value={checkOut}
              onChangeText={setCheckOut}
              placeholder="16:00"
            />
            <Button
              title={t('attendance.checkOutNow')}
              onPress={() => {
                if (!workerId) return;
                setCheckOut(nowHHMM());
                setStatusByWorker((m) => ({ ...m, [workerId]: 'out' }));
              }}
              // Cannot check out before checking in.
              disabled={!workerId || !checkIn}
            />
          </>
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
