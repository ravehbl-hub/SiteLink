/** Salary (FR-MGR-SRE): calculate via /salary/calculate (mode + rate resolved
 *  server-side), show the itemized breakdown, and download the payslip PDF. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { SalaryResult, WorkingHours } from '@sitelink/shared';
import { salaryApi, payslipApi, attendanceApi } from '../../lib/api/endpoints';
import { qk } from '../../lib/api/queryKeys';
import { apiUrl, bearerToken, ApiError } from '../../lib/api/client';
import { useWorkersList } from '../../lib/api/hooks';
import { currentMonthRange, formatCurrency, formatDate, toDateInput, dateInputToISO } from '../../lib/format';
import i18n from '../../i18n';

/** Derive the day's type from the DAY-grain rollup flags. Each DAY bucket is
 *  exactly one record, so at most one of these is 1. */
function whType(wh: WorkingHours): 'ATTENDANCE' | 'VACATION' | 'DISEASE' {
  if (wh.vacationDays >= 1) return 'VACATION';
  if (wh.diseaseDays >= 1) return 'DISEASE';
  return 'ATTENDANCE';
}

export function SalaryScreen() {
  const { t } = useTranslation();
  const workers = useWorkersList();
  const range = useMemo(currentMonthRange, []);
  const [workerId, setWorkerId] = useState('');
  const [periodStart, setPeriodStart] = useState(range.from);
  const [periodEnd, setPeriodEnd] = useState(range.to);
  const [result, setResult] = useState<SalaryResult | null>(null);
  // Pin the worker/period the DISPLAYED result was computed for, so the
  // working-hours details always follow the computed salary — not the live
  // selector (which can change without recomputing). Mirrors the app.
  const [resultWorkerId, setResultWorkerId] = useState('');
  const [resultPeriod, setResultPeriod] = useState<{ from: string; to: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  // Prices toggle (#4): default NO — the payslip renders hours-only unless the
  // manager opts in. BOTH the PDF download AND the share (email/whatsapp) read
  // this single flag, so the choice is made once in the actions area.
  const [includePrices, setIncludePrices] = useState(false);
  // HOURS-SPLIT payment controls (request-time only; default OFF → the calc is
  // byte-for-byte the existing flat/hourly behaviour and no split params are
  // sent). When ON, threshold (default 236) + a REQUIRED contractor rate reveal.
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splitThreshold, setSplitThreshold] = useState('236');
  const [contractorRate, setContractorRate] = useState('');
  // Client-side guard mirrors the backend's 400: contractor rate is required
  // once split is enabled. Surfaced as an inline hint under the input.
  const contractorRateMissing =
    splitEnabled && contractorRate.trim() === '';

  // Share flow: menu (channel picker) → confirm dialog → send.
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const [confirmChannel, setConfirmChannel] = useState<'email' | 'whatsapp' | null>(null);
  const shareMenuRef = useRef<HTMLDivElement>(null);

  const selectedWorker = workers.data?.items.find((w) => w.id === workerId);
  const workerName = selectedWorker
    ? `${selectedWorker.firstName} ${selectedWorker.lastName}`.trim()
    : t('salary.worker');
  const lang = (i18n.language.split('-')[0] || 'en') as 'he' | 'en' | 'tr';

  // Close the share menu on outside click / Escape.
  useEffect(() => {
    if (!shareMenuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (shareMenuRef.current && !shareMenuRef.current.contains(e.target as Node)) {
        setShareMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setShareMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [shareMenuOpen]);

  const share = useMutation({
    mutationFn: async (channel: 'email' | 'whatsapp') => {
      const body = { workerId, from: periodStart, to: periodEnd, lang, includePrices };
      if (channel === 'email') {
        await payslipApi.email(body);
        return { channel } as const;
      }
      const link = await payslipApi.whatsappLink(body);
      return { channel, link } as const;
    },
    onSuccess: (res) => {
      setError(null);
      if (res.channel === 'email') {
        setSuccess(t('salary.sharedEmail', { name: workerName }));
      } else {
        const msg = t('salary.whatsappMessage', { url: res.link.url });
        window.open(
          `https://wa.me/${res.link.phone}?text=${encodeURIComponent(msg)}`,
          '_blank',
        );
        setSuccess(t('salary.sharedWhatsapp', { name: workerName }));
      }
    },
    onError: (e, channel) => {
      setSuccess(null);
      setError(shareErrorMessage(e, channel));
    },
  });

  /** Map backend errors to clear, localized messaging.
   *  503 = SMTP not configured on the server (not the manager's fault);
   *  400 = worker has no email/phone for the chosen channel. */
  function shareErrorMessage(e: unknown, channel: 'email' | 'whatsapp'): string {
    if (e instanceof ApiError) {
      if (channel === 'email') {
        if (e.status === 503) return t('salary.shareNotConfigured');
        if (e.status === 400) return t('salary.shareNoEmail');
      } else if (e.status === 400) {
        return t('salary.shareNoPhone');
      }
    }
    return t('salary.shareFailed');
  }

  function openConfirm(channel: 'email' | 'whatsapp') {
    setShareMenuOpen(false);
    setConfirmChannel(channel);
  }

  function confirmSend() {
    if (!confirmChannel) return;
    const channel = confirmChannel;
    setConfirmChannel(null);
    setSuccess(null);
    setError(null);
    share.mutate(channel);
  }

  const calc = useMutation({
    mutationFn: () => {
      // Only attach split params when ENABLED; otherwise send the plain body so
      // the calc stays identical to the pre-split behaviour. threshold falls
      // back to the backend default (236) if left blank.
      const body: Parameters<typeof salaryApi.calculate>[0] = {
        workerId,
        periodStart,
        periodEnd,
      };
      if (splitEnabled) {
        body.splitEnabled = true;
        const thr = Number(splitThreshold);
        if (splitThreshold.trim() !== '' && Number.isFinite(thr)) {
          body.splitThreshold = thr;
        }
        const rate = Number(contractorRate);
        if (contractorRate.trim() !== '' && Number.isFinite(rate)) {
          body.contractorRate = rate;
        }
      }
      return salaryApi.calculate(body);
    },
    onSuccess: (r) => {
      setResult(r);
      // Pin the details query to what we just computed.
      setResultWorkerId(workerId);
      setResultPeriod({ from: periodStart, to: periodEnd });
      setError(null);
      setSuccess(null);
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : String(e));
      setResult(null);
      setResultWorkerId('');
      setResultPeriod(null);
      setSuccess(null);
    },
  });

  // Per-day working-hours breakdown behind the salary total. Reuses the EXISTING
  // /working-hours aggregate at DAY grain over the SAME worker + period the salary
  // was computed for — so the summed hours reconcile with the salary calc (both
  // derive from the same AttendanceRecord source). Enabled once a result exists.
  const whParams = {
    workerId: resultWorkerId,
    from: resultPeriod?.from ?? periodStart,
    to: resultPeriod?.to ?? periodEnd,
    grain: 'DAY' as const,
  };
  const workingHours = useQuery({
    queryKey: qk.workingHours(whParams),
    queryFn: () => attendanceApi.workingHours(whParams),
    enabled: Boolean(result && resultWorkerId && resultPeriod),
    staleTime: 5_000,
  });

  // Sort ascending by bucket start; each DAY bucket = one calendar day.
  const whRows = useMemo(
    () =>
      [...(workingHours.data ?? [])].sort((a, b) =>
        a.periodStart < b.periodStart ? -1 : a.periodStart > b.periodStart ? 1 : 0,
      ),
    [workingHours.data],
  );
  // The exact rate the salary calc used. Per ATTENDANCE row the line total is
  // hours × hourlyWage; vacation/disease rows contribute 0. For a flat hourly
  // calc the summed line totals equal result.gross.
  const hourlyWage = result?.hourlyWage ?? 0;
  const whTotals = useMemo(
    () =>
      whRows.reduce(
        (acc, wh) => ({
          hours: acc.hours + wh.totalHours,
          attendance: acc.attendance + wh.attendanceDays,
          vacation: acc.vacation + wh.vacationDays,
          disease: acc.disease + wh.diseaseDays,
          // Only ATTENDANCE rows carry paid hours toward the money total.
          money:
            acc.money +
            (whType(wh) === 'ATTENDANCE' ? wh.totalHours * hourlyWage : 0),
        }),
        { hours: 0, attendance: 0, vacation: 0, disease: 0, money: 0 },
      ),
    [whRows, hourlyWage],
  );

  // Reconciliation: for a flat hourly calc sum(line totals) === gross; for a
  // fixed monthly salary the rate is informational and won't sum to gross.
  // Detect purely by the AMOUNT MATCH — NOT result.mode: FlatSalaryStrategy stamps
  // mode:'fixed' for BOTH the hourly AND the monthly path (there is no distinct
  // 'hourly' mode), so a mode check would wrongly mark the common flat-hourly case
  // as non-reconciling. The amount match alone correctly distinguishes them.
  const reconciles =
    result != null && Math.abs(whTotals.money - result.gross) < 0.01;

  async function downloadPayslip() {
    setDownloading(true);
    setError(null);
    try {
      // The /reports/payslip.pdf endpoint expects `from`/`to`/`lang` (NOT
      // periodStart/periodEnd/locale). Sending the wrong names left from/to
      // undefined → the PDF rendered an empty period (0 hours). Map to the
      // backend contract.
      const url = apiUrl('/reports/payslip.pdf', {
        workerId,
        from: periodStart,
        to: periodEnd,
        lang: i18n.language,
        // #4: hours-only by default; only render money when opted in.
        includePrices,
      });
      const token = await bearerToken();
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`PDF request failed (${res.status})`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      window.open(objectUrl, '_blank');
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="section-title" style={{ margin: 0 }}>
          {t('salary.title')}
        </h1>
      </div>

      <div className="card">
        <div className="form-row">
          <div className="field" style={{ minWidth: 240 }}>
            <label>{t('salary.worker')}</label>
            <select className="select" value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
              <option value="">{t('salary.worker')}</option>
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
              value={toDateInput(periodStart)}
              onChange={(e) => setPeriodStart(dateInputToISO(e.target.value))}
            />
          </div>
          <div className="field">
            <label>{t('common.to')}</label>
            <input
              className="input"
              type="date"
              value={toDateInput(periodEnd)}
              onChange={(e) => setPeriodEnd(dateInputToISO(e.target.value))}
            />
          </div>
          <button
            className="btn btn-primary"
            disabled={!workerId || calc.isPending || contractorRateMissing}
            aria-busy={calc.isPending}
            onClick={() => calc.mutate()}
          >
            {calc.isPending ? (
              <>
                <span
                  className="sl-spinner"
                  aria-hidden
                  style={{ marginInlineEnd: 'var(--sl-space-1)' }}
                />
                {t('salary.calculating')}
              </>
            ) : (
              t('salary.calculate')
            )}
          </button>
        </div>

        {/* HOURS-SPLIT controls: a toggle (default OFF) that reveals a threshold
            (default 236) + a REQUIRED contractor rate. RTL-safe logical props;
            money/rate inputs align to the end. */}
        <div
          className="form-row"
          style={{ alignItems: 'flex-end', marginBlockStart: 'var(--sl-space-2)' }}
        >
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--sl-space-1)',
              cursor: 'pointer',
              userSelect: 'none',
              color: 'var(--sl-color-text-muted)',
            }}
          >
            <input
              type="checkbox"
              checked={splitEnabled}
              onChange={(e) => setSplitEnabled(e.target.checked)}
            />
            {t('salary.splitToggle')}
          </label>

          {splitEnabled ? (
            <>
              <div className="field" style={{ maxWidth: 160 }}>
                <label>{t('salary.splitThreshold')}</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  style={{ textAlign: 'end' }}
                  value={splitThreshold}
                  onChange={(e) => setSplitThreshold(e.target.value)}
                />
              </div>
              <div className="field" style={{ maxWidth: 180 }}>
                <label>{t('salary.splitContractorRate')}</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  step="any"
                  inputMode="decimal"
                  aria-invalid={contractorRateMissing}
                  aria-describedby={
                    contractorRateMissing ? 'split-contractor-rate-hint' : undefined
                  }
                  style={{ textAlign: 'end' }}
                  value={contractorRate}
                  onChange={(e) => setContractorRate(e.target.value)}
                />
                {contractorRateMissing ? (
                  <span
                    id="split-contractor-rate-hint"
                    className="muted"
                    style={{
                      color: 'var(--sl-color-danger)',
                      fontSize: 'var(--sl-font-size-sm, 0.85em)',
                      marginBlockStart: 'var(--sl-space-1)',
                    }}
                  >
                    {t('salary.splitContractorRateRequired')}
                  </span>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </div>

      {error ? <div className="banner banner-danger">{error}</div> : null}
      {success ? (
        <div
          className="banner"
          style={{
            background: 'var(--sl-color-success-subtle)',
            color: 'var(--sl-color-success)',
          }}
        >
          {success}
        </div>
      ) : null}

      {result ? (
        <div className="card sl-fade-in" style={{ position: 'relative' }}>
          {/* #7: calculating overlay while a recompute is in flight over the
              currently-displayed result. Motion is disabled under reduced-motion
              (see .sl-calc-overlay / .sl-spinner in styles.css). */}
          {calc.isPending ? (
            <div className="sl-calc-overlay" role="status" aria-live="polite">
              <span className="sl-spinner sl-spinner-lg" aria-hidden />
              <span className="sl-calc-label">{t('salary.calculating')}</span>
            </div>
          ) : null}
          <div className="page-header" style={{ marginBlockEnd: 'var(--sl-space-3)' }}>
            <h3 className="subsection-title" style={{ margin: 0 }}>
              {t('salary.result')}
            </h3>
            <div className="header-spacer" />
          </div>
          {/* #5: the three key figures — Hourly rate | Gross | Net — on ONE
              horizontal row. `grid-kpi` auto-fits: 3-up on desktop, stacks on
              narrow screens. Logical order 1→2→3 mirrors under RTL. Net keeps
              its negative-danger treatment. */}
          <div
            className="grid grid-kpi"
            style={{
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
              marginBlockEnd: 'var(--sl-space-4)',
            }}
          >
            <div className="kpi">
              <div className="kpi-label">{t('salary.hourlyRate')}</div>
              <div className="kpi-value">
                {formatCurrency(result.hourlyWage, result.currency)}
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">{t('salary.gross')}</div>
              <div className="kpi-value">{formatCurrency(result.gross, result.currency)}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">{t('salary.net')}</div>
              <div
                className="kpi-value"
                style={
                  result.net !== undefined && result.net < 0
                    ? { color: 'var(--sl-color-danger)' }
                    : undefined
                }
              >
                {result.net !== undefined
                  ? formatCurrency(result.net, result.currency)
                  : '—'}
              </div>
            </div>
          </div>

          <h4 className="subsection-title">{t('salary.breakdown')}</h4>
          <div className="table-wrap">
            <table className="data">
              <tbody>
                {result.breakdown.map((line, i) => (
                  <tr key={`${line.label}-${i}`}>
                    <td>{line.label}</td>
                    <td style={{ textAlign: 'end' }}>
                      {formatCurrency(line.amount, result.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* HOURS-SPLIT breakdown: rendered only when the calc was run with
              split enabled (result.split?.enabled). Shows the Personnel line
              (hours × personnel rate) + the Contractor line (hours × contractor
              rate) + the combined total — which equals result.gross. This shows
              on-screen normally (the display-prices flag governs the PDF only).
              hrs | rate | amount, money/rate aligned to the end for RTL. */}
          {result.split?.enabled ? (
            <>
              <h4
                className="subsection-title"
                style={{ marginBlockStart: 'var(--sl-space-4)' }}
              >
                {t('salary.splitTitle')}
              </h4>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>{t('salary.splitToggle')}</th>
                      <th style={{ textAlign: 'end' }}>{t('salary.splitHours')}</th>
                      <th style={{ textAlign: 'end' }}>{t('salary.splitRate')}</th>
                      <th style={{ textAlign: 'end' }}>{t('salary.splitAmount')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>{t('salary.splitPersonnel')}</td>
                      <td style={{ textAlign: 'end' }}>{result.split.personnelHours}</td>
                      <td style={{ textAlign: 'end' }}>
                        {formatCurrency(result.split.personnelRate, result.currency)}
                      </td>
                      <td style={{ textAlign: 'end' }}>
                        {formatCurrency(result.split.personnelAmount, result.currency)}
                      </td>
                    </tr>
                    <tr>
                      <td>{t('salary.splitContractor')}</td>
                      <td style={{ textAlign: 'end' }}>{result.split.contractorHours}</td>
                      <td style={{ textAlign: 'end' }}>
                        {formatCurrency(result.split.contractorRate, result.currency)}
                      </td>
                      <td style={{ textAlign: 'end' }}>
                        {formatCurrency(result.split.contractorAmount, result.currency)}
                      </td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr style={{ fontWeight: 'var(--sl-font-weight-bold, 700)' }}>
                      <td>{t('salary.splitTotal')}</td>
                      <td style={{ textAlign: 'end' }}>
                        {result.split.personnelHours + result.split.contractorHours}
                      </td>
                      <td />
                      <td style={{ textAlign: 'end' }}>
                        {formatCurrency(
                          result.split.personnelAmount + result.split.contractorAmount,
                          result.currency,
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          ) : null}

          {/* NET WAGE (נטו): deductions + net. Server-computed on the
              single-calc path (result.net = gross − loans − advances). Display
              AS-IS — no client recompute — so it reconciles with the payslip
              PDF. Optional: only render when the backend populated net. */}
          {result.net !== undefined ? (
            <>
              <h4 className="subsection-title" style={{ marginBlockStart: 'var(--sl-space-4)' }}>
                {t('salary.deductions')}
              </h4>
              <div className="table-wrap">
                <table className="data">
                  <tbody>
                    <tr>
                      <td>{t('salary.loans')}</td>
                      <td style={{ textAlign: 'end', color: 'var(--sl-color-danger)' }}>
                        −{formatCurrency(result.loansTotal ?? 0, result.currency)}
                      </td>
                    </tr>
                    <tr>
                      <td>{t('salary.advances')}</td>
                      <td style={{ textAlign: 'end', color: 'var(--sl-color-danger)' }}>
                        −{formatCurrency(result.advancesTotal ?? 0, result.currency)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          <p className="muted" style={{ marginBlockStart: 'var(--sl-space-3)' }}>
            {t('dashboard.computedAt')}: {formatDate(result.computedAt)}
          </p>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--sl-space-2)',
              alignItems: 'center',
              marginBlockStart: 'var(--sl-space-3)',
            }}
          >
            {/* #4: Display-prices choice — a single checkbox (default OFF =
                hours-only) that BOTH the Download and the Share actions read.
                Placed FIRST in the actions row so the choice precedes the
                buttons; logical props keep it RTL-safe. */}
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--sl-space-1)',
                cursor: 'pointer',
                userSelect: 'none',
                color: 'var(--sl-color-text-muted)',
              }}
            >
              <input
                type="checkbox"
                checked={includePrices}
                onChange={(e) => setIncludePrices(e.target.checked)}
              />
              {t('salary.displayPrices')}
            </label>

            <button
              className="btn"
              disabled={downloading}
              onClick={() => void downloadPayslip()}
            >
              {downloading ? t('workers.uploading') : t('salary.downloadPayslip')}
            </button>

            {/* Share: menu → confirm dialog → email/whatsapp. Enabled once a
                worker + period has been computed (result present). */}
            <div ref={shareMenuRef} style={{ position: 'relative' }}>
              <button
                className="btn btn-primary"
                disabled={share.isPending}
                aria-haspopup="menu"
                aria-expanded={shareMenuOpen}
                onClick={() => setShareMenuOpen((o) => !o)}
              >
                <span aria-hidden style={{ marginInlineEnd: 'var(--sl-space-1)' }}>
                  ⤴
                </span>
                {share.isPending ? t('salary.sending') : t('salary.share')}
              </button>

              {shareMenuOpen ? (
                <div
                  role="menu"
                  style={{
                    position: 'absolute',
                    insetBlockStart: 'calc(100% + var(--sl-space-1))',
                    insetInlineStart: 0,
                    minWidth: 200,
                    zIndex: 20,
                    background: 'var(--sl-color-surface)',
                    borderRadius: 'var(--sl-radius-neu-cardLg, var(--sl-radius-lg))',
                    boxShadow: 'var(--sl-shadow-raised-lg, var(--sl-elevation-lg))',
                    padding: 'var(--sl-space-2)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--sl-space-1)',
                  }}
                >
                  <button
                    className="btn btn-ghost"
                    role="menuitem"
                    style={{ justifyContent: 'flex-start', textAlign: 'start' }}
                    onClick={() => openConfirm('email')}
                  >
                    {t('salary.sendEmail')}
                  </button>
                  <button
                    className="btn btn-ghost"
                    role="menuitem"
                    style={{ justifyContent: 'flex-start', textAlign: 'start' }}
                    onClick={() => openConfirm('whatsapp')}
                  >
                    {t('salary.sendWhatsapp')}
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          {/* Details of working hours — the per-day breakdown behind the salary
              hours total. Same worker/period, DAY-grain rollup; the TOTAL row
              reconciles with the salary calc's attendance hours. */}
          <details open style={{ marginBlockStart: 'var(--sl-space-4)' }}>
            <summary
              className="subsection-title"
              style={{ cursor: 'pointer', marginBlockEnd: 'var(--sl-space-2)' }}
            >
              {t('salary.workingHoursDetails')}
            </summary>
            {workingHours.isLoading ? (
              <p className="muted">{t('common.loading')}</p>
            ) : whRows.length === 0 ? (
              <div className="empty-state">{t('salary.whNoData')}</div>
            ) : (
              <>
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>{t('salary.whDate')}</th>
                        <th style={{ textAlign: 'end' }}>{t('salary.whHours')}</th>
                        <th>{t('salary.whType')}</th>
                        <th style={{ textAlign: 'end' }}>{t('salary.whLineTotal')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {whRows.map((wh, i) => {
                        const type = whType(wh);
                        const isAttendance = type === 'ATTENDANCE';
                        return (
                          <tr key={`${wh.periodStart}-${i}`}>
                            <td>{formatDate(wh.periodStart)}</td>
                            <td style={{ textAlign: 'end' }}>
                              {isAttendance ? wh.totalHours : '—'}
                            </td>
                            <td>{t(`attendanceType.${type}`)}</td>
                            <td style={{ textAlign: 'end' }}>
                              {isAttendance
                                ? formatCurrency(wh.totalHours * hourlyWage, result.currency)
                                : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ fontWeight: 'var(--sl-font-weight-bold, 700)' }}>
                        <td>{t('salary.whTotal')}</td>
                        <td style={{ textAlign: 'end' }}>{whTotals.hours}</td>
                        <td>{t('salary.whMoneyTotal')}</td>
                        <td style={{ textAlign: 'end' }}>
                          {formatCurrency(whTotals.money, result.currency)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <p className="muted" style={{ marginBlockStart: 'var(--sl-space-2)' }}>
                  {t('salary.whSummary', {
                    attendance: whTotals.attendance,
                    vacation: whTotals.vacation,
                    disease: whTotals.disease,
                  })}
                </p>
                <p className="muted" style={{ marginBlockStart: 'var(--sl-space-1)' }}>
                  {reconciles ? t('salary.whReconcileNote') : t('salary.whFixedNote')}
                </p>
              </>
            )}
          </details>
        </div>
      ) : null}

      {confirmChannel ? (
        <div className="modal-overlay" onClick={() => setConfirmChannel(null)}>
          <div
            className="modal"
            style={{ maxWidth: 420 }}
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3 className="subsection-title" style={{ margin: 0 }}>
                {t('salary.share')}
              </h3>
            </div>
            <p>
              {confirmChannel === 'email'
                ? t('salary.confirmShareEmail', { name: workerName })
                : t('salary.confirmShareWhatsapp', { name: workerName })}
            </p>
            {/* #4: prices choice mirrored in the share confirm — default OFF.
                Reads/writes the same flag the share POST body sends. */}
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--sl-space-1)',
                cursor: 'pointer',
                userSelect: 'none',
                marginBlockEnd: 'var(--sl-space-2)',
              }}
            >
              <input
                type="checkbox"
                checked={includePrices}
                onChange={(e) => setIncludePrices(e.target.checked)}
              />
              {t('salary.displayPrices')}
            </label>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setConfirmChannel(null)}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary" onClick={confirmSend}>
                {t('salary.confirmSend')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
