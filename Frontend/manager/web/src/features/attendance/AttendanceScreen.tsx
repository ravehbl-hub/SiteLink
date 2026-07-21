/** Attendance / Vacation / Disease (FR-MGR-ATT).
 *  Record entries per worker with clock-in/out + site + manual hours, then
 *  edit/remove them. The derived working-hours rollup lives elsewhere (salary/PDF);
 *  this screen only manages the raw records. */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  AttendanceType,
  type AttendanceRecord,
  type CreateAttendanceInput,
  type UpdateAttendanceInput,
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

/** ISO datetime → "HH:MM" (local) for <input type="time">. Empty when absent. */
function isoToTimeInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** Combine a YYYY-MM-DD date-input value + "HH:MM" time into an ISO datetime.
 *  Returns null when no time is entered (clock field left blank). */
function combineDateTimeToISO(dateInput: string, timeInput: string): string | null {
  if (!dateInput || !timeInput) return null;
  const d = new Date(`${dateInput}T${timeInput}`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** Locale time (HH:MM) for list display; em-dash when absent. */
function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(d);
}

export function AttendanceScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const workers = useWorkersList();
  const sites = useSitesList();
  const [workerId, setWorkerId] = useState('');
  const range = useMemo(currentMonthRange, []);
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AttendanceRecord | null>(null);

  const listParams = { workerId: workerId || undefined, from, to, pageSize: 200 };
  // Live attendance: entries can land while the manager watches, so poll every 20s
  // (medium cadence) while mounted+visible, never in the background. `enabled`
  // already pauses it until a worker is picked, and refetchInterval auto-pauses
  // when the query unmounts. Short staleTime so focus/mount within the interval
  // still shows fresh rows.
  const list = useQuery({
    queryKey: qk.attendance(listParams),
    queryFn: () => attendanceApi.list(listParams),
    enabled: Boolean(workerId),
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
    staleTime: 5_000,
  });

  const siteName = (siteId: string | null | undefined): string => {
    if (!siteId) return '—';
    return sites.data?.items.find((s) => s.id === siteId)?.name ?? '—';
  };

  const removeMut = useMutation({
    mutationFn: (id: string) => attendanceApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attendance'] });
      // Attendance drives the working-hours + dashboard workforce rollups.
      qc.invalidateQueries({ queryKey: ['working-hours'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
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
                    <th style={{ textAlign: 'start' }}>{t('attendance.checkIn')}</th>
                    <th style={{ textAlign: 'start' }}>{t('attendance.checkOut')}</th>
                    <th>{t('attendance.hours')}</th>
                    <th>{t('attendance.site')}</th>
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
                      <td style={{ textAlign: 'start' }}>{formatTime(r.checkIn)}</td>
                      <td style={{ textAlign: 'start' }}>{formatTime(r.checkOut)}</td>
                      <td>{r.hours ?? '—'}</td>
                      <td>{siteName(r.siteId)}</td>
                      <td>{r.notes ?? '—'}</td>
                      <td>
                        <div className="row-actions">
                          <button className="btn btn-sm" onClick={() => setEditing(r)}>
                            {t('common.edit')}
                          </button>
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
      )}

      {creating && workerId ? (
        <AttendanceForm workerId={workerId} onClose={() => setCreating(false)} />
      ) : null}
      {editing ? (
        <AttendanceForm
          workerId={editing.workerId}
          record={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function AttendanceForm({
  workerId,
  record,
  onClose,
}: {
  workerId: string;
  record?: AttendanceRecord;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const sites = useSitesList();
  const isEdit = Boolean(record);
  const [date, setDate] = useState(
    toDateInput(record?.date ?? new Date().toISOString()),
  );
  const [type, setType] = useState<AttendanceType>(record?.type ?? AttendanceType.ATTENDANCE);
  const [hours, setHours] = useState(record?.hours ?? 8);
  const [siteId, setSiteId] = useState(record?.siteId ?? '');
  const [checkIn, setCheckIn] = useState(isoToTimeInput(record?.checkIn));
  const [checkOut, setCheckOut] = useState(isoToTimeInput(record?.checkOut));
  const [notes, setNotes] = useState(record?.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  // The site the worker actually REGISTERED at (the record's original site) — shown
  // read-only for reference while editing, above the editable site picker below.
  const registeredSiteName =
    isEdit && record?.siteId
      ? sites.data?.items.find((s) => s.id === record.siteId)?.name ?? record.siteId
      : null;

  const mut = useMutation({
    mutationFn: async () => {
      const checkInISO = combineDateTimeToISO(date, checkIn);
      const checkOutISO = combineDateTimeToISO(date, checkOut);
      // Mirror the backend 400: check-out must be after check-in when both set.
      if (checkInISO && checkOutISO && new Date(checkOutISO) <= new Date(checkInISO)) {
        throw new Error(t('attendance.checkOutBeforeIn'));
      }
      const body: CreateAttendanceInput = {
        workerId,
        siteId: siteId || null,
        date: dateInputToISO(date),
        type,
        checkIn: checkInISO,
        checkOut: checkOutISO,
        hours: type === AttendanceType.ATTENDANCE ? hours : null,
        notes: notes || null,
      };
      if (record) {
        const patch: UpdateAttendanceInput = { ...body };
        delete (patch as { workerId?: string }).workerId;
        return attendanceApi.update(record.id, patch);
      }
      return attendanceApi.create(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attendance'] });
      qc.invalidateQueries({ queryKey: ['working-hours'] });
      // A new/edited attendance/vacation/disease entry also moves the dashboard rollup.
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  return (
    <Modal
      title={isEdit ? t('common.edit') : t('attendance.record')}
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
      <div className="form-row">
        <Field label={t('attendance.checkIn')}>
          <input
            className="input"
            type="time"
            style={{ textAlign: 'start' }}
            value={checkIn}
            onChange={(e) => setCheckIn(e.target.value)}
          />
        </Field>
        <Field label={t('attendance.checkOut')}>
          <input
            className="input"
            type="time"
            style={{ textAlign: 'start' }}
            value={checkOut}
            onChange={(e) => setCheckOut(e.target.value)}
          />
        </Field>
      </div>
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
      {registeredSiteName ? (
        <Field label={t('attendance.registeredAt')}>
          <div className="input" style={{ display: 'flex', alignItems: 'center', opacity: 0.8 }}>
            {registeredSiteName}
          </div>
        </Field>
      ) : null}
      <Field label={t('attendance.site')}>
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
