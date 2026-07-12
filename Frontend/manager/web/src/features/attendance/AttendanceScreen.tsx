/** Attendance / Vacation / Disease + Working Hours (FR-MGR-ATT).
 *  Record entries per worker, edit/remove, and view derived working-hours by
 *  day/week/month. */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  AttendanceType,
  type CreateAttendanceInput,
  type WorkingHoursGrain,
} from '@sitelink/shared';
import { attendanceApi } from '../../lib/api/endpoints';
import { qk } from '../../lib/api/queryKeys';
import { useSitesList, useWorkersList } from '../../lib/api/hooks';
import { DataState, Modal, Field, Chip } from '../../components/ui';
import { currentMonthRange, formatDate, toDateInput, dateInputToISO } from '../../lib/format';

function attendanceTone(type: AttendanceType): 'success' | 'info' | 'warning' {
  if (type === AttendanceType.ATTENDANCE) return 'success';
  if (type === AttendanceType.VACATION) return 'info';
  return 'warning';
}

export function AttendanceScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const workers = useWorkersList();
  const [workerId, setWorkerId] = useState('');
  const range = useMemo(currentMonthRange, []);
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [grain, setGrain] = useState<WorkingHoursGrain>('DAY');
  const [creating, setCreating] = useState(false);

  const listParams = { workerId: workerId || undefined, from, to, pageSize: 200 };
  const list = useQuery({
    queryKey: qk.attendance(listParams),
    queryFn: () => attendanceApi.list(listParams),
    enabled: Boolean(workerId),
  });

  const whParams = { workerId: workerId || undefined, from, to, grain };
  const workingHours = useQuery({
    queryKey: qk.workingHours(whParams),
    queryFn: () => attendanceApi.workingHours(whParams),
    enabled: Boolean(workerId),
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => attendanceApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['attendance'] }),
  });

  return (
    <div>
      <div className="page-header">
        <h1 className="section-title" style={{ margin: 0 }}>
          {t('attendance.title')}
        </h1>
      </div>

      <div className="card">
        <div className="form-row">
          <div className="field" style={{ minWidth: 240 }}>
            <label>{t('attendance.selectWorker')}</label>
            <select className="select" value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
              <option value="">{t('attendance.selectWorker')}</option>
              {workers.data?.items.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.firstName} {w.lastName}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>{t('common.from')}</label>
            <input
              className="input"
              type="date"
              value={toDateInput(from)}
              onChange={(e) => setFrom(dateInputToISO(e.target.value))}
            />
          </div>
          <div className="field">
            <label>{t('common.to')}</label>
            <input
              className="input"
              type="date"
              value={toDateInput(to)}
              onChange={(e) => setTo(dateInputToISO(e.target.value))}
            />
          </div>
          <button
            className="btn btn-primary"
            disabled={!workerId}
            onClick={() => setCreating(true)}
          >
            {t('attendance.record')}
          </button>
        </div>
      </div>

      {!workerId ? (
        <div className="empty-state">{t('attendance.selectWorker')}</div>
      ) : (
        <>
          <div className="card">
            <h3 className="subsection-title">{t('attendance.title')}</h3>
            <DataState
              isLoading={list.isLoading}
              error={list.error}
              isEmpty={list.data?.items.length === 0}
            >
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>{t('common.date')}</th>
                      <th>{t('attendance.type')}</th>
                      <th>{t('attendance.hours')}</th>
                      <th>{t('common.notes')}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {list.data?.items.map((r) => (
                      <tr key={r.id}>
                        <td>{formatDate(r.date)}</td>
                        <td>
                          <Chip tone={attendanceTone(r.type)}>{t(`attendanceType.${r.type}`)}</Chip>
                        </td>
                        <td>{r.hours ?? '—'}</td>
                        <td>{r.notes ?? '—'}</td>
                        <td>
                          <div className="row-actions">
                            <button
                              className="btn btn-sm btn-danger"
                              onClick={() => removeMut.mutate(r.id)}
                            >
                              {t('common.remove')}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </DataState>
          </div>

          <div className="card">
            <div className="page-header" style={{ marginBlockEnd: 'var(--sl-space-3)' }}>
              <h3 className="subsection-title" style={{ margin: 0 }}>
                {t('attendance.workingHours')}
              </h3>
              <div className="header-spacer" />
              <select
                className="select"
                style={{ width: 'auto' }}
                value={grain}
                onChange={(e) => setGrain(e.target.value as WorkingHoursGrain)}
              >
                <option value="DAY">{t('attendance.day')}</option>
                <option value="WEEK">{t('attendance.week')}</option>
                <option value="MONTH">{t('attendance.month')}</option>
              </select>
            </div>
            <DataState
              isLoading={workingHours.isLoading}
              error={workingHours.error}
              isEmpty={workingHours.data?.length === 0}
            >
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>{t('attendance.period')}</th>
                      <th>{t('attendance.totalHours')}</th>
                      <th>{t('dashboard.attendanceDays')}</th>
                      <th>{t('dashboard.vacationDays')}</th>
                      <th>{t('dashboard.diseaseDays')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workingHours.data?.map((wh, i) => (
                      <tr key={`${wh.periodStart}-${i}`}>
                        <td>
                          {formatDate(wh.periodStart)} – {formatDate(wh.periodEnd)}
                        </td>
                        <td>{wh.totalHours}</td>
                        <td>{wh.attendanceDays}</td>
                        <td>{wh.vacationDays}</td>
                        <td>{wh.diseaseDays}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </DataState>
          </div>
        </>
      )}

      {creating && workerId ? (
        <AttendanceForm workerId={workerId} onClose={() => setCreating(false)} />
      ) : null}
    </div>
  );
}

function AttendanceForm({ workerId, onClose }: { workerId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const sites = useSitesList();
  const [date, setDate] = useState(toDateInput(new Date().toISOString()));
  const [type, setType] = useState<AttendanceType>(AttendanceType.ATTENDANCE);
  const [hours, setHours] = useState(8);
  const [siteId, setSiteId] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: async () => {
      const body: CreateAttendanceInput = {
        workerId,
        siteId: siteId || null,
        date: dateInputToISO(date),
        type,
        hours: type === AttendanceType.ATTENDANCE ? hours : null,
        notes: notes || null,
      };
      return attendanceApi.create(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attendance'] });
      qc.invalidateQueries({ queryKey: ['working-hours'] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  return (
    <Modal
      title={t('attendance.record')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" disabled={mut.isPending} onClick={() => mut.mutate()}>
            {t('common.save')}
          </button>
        </>
      }
    >
      {error ? <div className="banner banner-danger">{error}</div> : null}
      <Field label={t('common.date')}>
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label={t('attendance.type')}>
        <select className="select" value={type} onChange={(e) => setType(e.target.value as AttendanceType)}>
          {Object.values(AttendanceType).map((a) => (
            <option key={a} value={a}>
              {t(`attendanceType.${a}`)}
            </option>
          ))}
        </select>
      </Field>
      {type === AttendanceType.ATTENDANCE ? (
        <Field label={t('attendance.hours')}>
          <input
            className="input"
            type="number"
            min={0}
            value={hours}
            onChange={(e) => setHours(Number(e.target.value) || 0)}
          />
        </Field>
      ) : null}
      <Field label={t('nav.sites')}>
        <select className="select" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
          <option value="">{t('common.none')}</option>
          {sites.data?.items.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('common.notes')}>
        <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Modal>
  );
}
