/** Salary (FR-MGR-SRE): calculate via /salary/calculate (mode + rate resolved
 *  server-side), show the itemized breakdown, and download the payslip PDF. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { SalaryResult, SalaryBatchResult, WorkingHours } from '@sitelink/shared';
import { salaryApi, payslipApi, payrollApi, attendanceApi } from '../../lib/api/endpoints';
import { qk } from '../../lib/api/queryKeys';
import { apiUrl, bearerToken, ApiError } from '../../lib/api/client';
import { useWorkersList } from '../../lib/api/hooks';
import { useAuth } from '../../app/AuthProvider';
import { currentMonthRange, formatCurrency, formatDate, toDateInput, dateInputToISO } from '../../lib/format';
import i18n from '../../i18n';

/** Derive the day's type from the DAY-grain rollup flags. Each DAY bucket is
 *  exactly one record, so at most one of these is 1. */
function whType(wh: WorkingHours): 'ATTENDANCE' | 'VACATION' | 'DISEASE' {
  if (wh.vacationDays >= 1) return 'VACATION';
  if (wh.diseaseDays >= 1) return 'DISEASE';
  return 'ATTENDANCE';
}

/** The split threshold (in hours) the backend applies to ATTENDANCE hours.
 *  Kept as a module constant so the auto-open comparison is a fixed 236 even if
 *  the manager later edits the (informational) threshold input. */
export const SPLIT_THRESHOLD_DEFAULT = 236;

/** Sentinel worker-id for the "All workers" batch run. A reserved value that can
 *  never collide with a real worker id, so `workerId === ALL_WORKERS` cleanly
 *  distinguishes the batch path from the single-worker path throughout. */
export const ALL_WORKERS = '__all__';

/** PURE — a batch row's deductions + net, mirroring the backend's
 *  `deductionsTotal = loansTotal + advancesTotal` and `net = gross − deductionsTotal`
 *  (net is NOT floored — it can go negative when loans/advances exceed gross).
 *  Exported for unit tests; the FE displays the server's values but this documents
 *  the exact relationship the table renders. */
export function batchRowNet(
  gross: number,
  loansTotal: number,
  advancesTotal: number,
): { deductionsTotal: number; net: number } {
  const deductionsTotal = loansTotal + advancesTotal;
  return { deductionsTotal, net: gross - deductionsTotal };
}

/** PURE — sum of ATTENDANCE-only hours for a period. Mirrors the
 *  `whType(wh) === 'ATTENDANCE'` filter used by `whTotals.money`, since that is
 *  exactly the bucket the backend splits at 236 (vacation/disease excluded).
 *  Exported for unit tests. */
export function attendanceHours(rows: WorkingHours[]): number {
  return rows.reduce(
    (sum, row) => sum + (whType(row) === 'ATTENDANCE' ? row.totalHours : 0),
    0,
  );
}

/** PURE — should the split controls auto-open? True only when the worker's
 *  ATTENDANCE hours STRICTLY exceed the threshold AND split is not already on
 *  (so we never fight a manager who has it on/off deliberately). Exported for
 *  unit tests. */
export function shouldAutoOpenSplit(
  attendanceHoursTotal: number,
  threshold: number,
  splitAlreadyEnabled: boolean,
): boolean {
  return attendanceHoursTotal > threshold && !splitAlreadyEnabled;
}

/** PURE — the download filename for a batch payroll export, mirroring the backend
 *  attachment name (`payroll-<YYYYMMDD>-<YYYYMMDD>.<ext>`). `from`/`to` are ISO
 *  datetimes; the compact tag is the date part with dashes stripped. Exported for
 *  unit tests and reused by the two authed blob downloads. */
export function payrollExportFilename(from: string, to: string, ext: 'pdf' | 'xlsx'): string {
  const tag = (s: string): string => s.slice(0, 10).replace(/-/g, '');
  return `payroll-${tag(from)}-${tag(to)}.${ext}`;
}

export function SalaryScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const workers = useWorkersList();
  const range = useMemo(currentMonthRange, []);
  const [workerId, setWorkerId] = useState('');
  const [periodStart, setPeriodStart] = useState(range.from);
  const [periodEnd, setPeriodEnd] = useState(range.to);
  const [result, setResult] = useState<SalaryResult | null>(null);
  // BATCH ("All workers") result — display-only table, mutually exclusive with the
  // single-worker `result` (each Calculate clears the other). Only ever set on the
  // sentinel path; the single-worker path never touches it.
  const [batchResult, setBatchResult] = useState<SalaryBatchResult | null>(null);
  // True only for the "All workers" sentinel — used to hide the split section and
  // early-return the auto-open effect (both are single-worker only).
  const isBatch = workerId === ALL_WORKERS;
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
  // AUTO-OPEN (Option A): when a just-computed worker/period exceeds 236 ATTENDANCE
  // hours we auto-enable the split controls once and show a one-time hint. The ref
  // records the last worker+period the auto-open fired for, so it fires ONCE per
  // crossing and never re-enables split on the same loaded data if the manager
  // manually turns it back OFF.
  const [splitAutoOpened, setSplitAutoOpened] = useState(false);
  const autoOpenedForRef = useRef<string | null>(null);

  // Share flow: menu (channel picker) → confirm dialog → send.
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const [confirmChannel, setConfirmChannel] = useState<'email' | 'whatsapp' | null>(null);
  const shareMenuRef = useRef<HTMLDivElement>(null);

  // ── BATCH ("All workers") EXPORT + SHARE ──────────────────────────────────
  // Reverses the earlier display-only decision for the batch table (intended). PDF +
  // real .xlsx download the WHOLE table; Share → Email (a manager-typed recipient,
  // prefilled with the manager's own email) / WhatsApp (a manager-typed phone).
  const [batchExporting, setBatchExporting] = useState<null | 'pdf' | 'xlsx'>(null);
  const [batchShareMenuOpen, setBatchShareMenuOpen] = useState(false);
  const batchShareMenuRef = useRef<HTMLDivElement>(null);
  // Email modal: a manager-TYPED recipient, prefilled with the logged-in manager's
  // own email (differs from the single payslip, which forces the worker's address).
  const [batchEmailOpen, setBatchEmailOpen] = useState(false);
  const [batchEmailTo, setBatchEmailTo] = useState('');
  // WhatsApp modal: a manager-TYPED phone number (not a worker's stored phone).
  const [batchWhatsappOpen, setBatchWhatsappOpen] = useState(false);
  const [batchPhone, setBatchPhone] = useState('');

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

  // Close the BATCH share menu on outside click / Escape (mirror of the above).
  useEffect(() => {
    if (!batchShareMenuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (batchShareMenuRef.current && !batchShareMenuRef.current.contains(e.target as Node)) {
        setBatchShareMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setBatchShareMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [batchShareMenuOpen]);

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
    // `overrideWorkerId` is set when DRILLING DOWN from the batch table into a single
    // worker: it targets that worker instead of the (ALL_WORKERS) selector value and
    // forces a PLAIN calc (no split) so the detail matches the flat batch row.
    mutationFn: (overrideWorkerId?: string) => {
      const wid = overrideWorkerId ?? workerId;
      // Only attach split params when ENABLED; otherwise send the plain body so
      // the calc stays identical to the pre-split behaviour. threshold falls
      // back to the backend default (236) if left blank.
      const body: Parameters<typeof salaryApi.calculate>[0] = {
        workerId: wid,
        periodStart,
        periodEnd,
      };
      if (splitEnabled && !overrideWorkerId) {
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
    onSuccess: (r, overrideWorkerId) => {
      setResult(r);
      // Pin the details query to what we just computed.
      setResultWorkerId(overrideWorkerId ?? workerId);
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

  // BATCH calc: flat/hourly + fixed roll-up for ALL active workers in the caller's
  // company (scope resolved server-side). NO split — that stays single-worker. On
  // success we set batchResult and CLEAR the single-worker result (mutually
  // exclusive views); on error we mirror the single-calc error handling.
  const batchCalc = useMutation({
    mutationFn: () => salaryApi.calculateAll({ periodStart, periodEnd }),
    onSuccess: (r) => {
      setBatchResult(r);
      setResult(null);
      setResultWorkerId('');
      setResultPeriod(null);
      setError(null);
      setSuccess(null);
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : String(e));
      setBatchResult(null);
      setSuccess(null);
    },
  });

  // Single Calculate button dispatch: the sentinel routes to the batch run (and
  // clears any single result on its own onSuccess); every other value keeps the
  // EXISTING single-worker `calc.mutate()` path byte-for-byte unchanged.
  function runCalculate() {
    if (isBatch) {
      batchCalc.mutate();
    } else {
      // Leaving the batch view: a single-worker calc supersedes any prior table.
      setBatchResult(null);
      calc.mutate(undefined);
    }
  }

  // DRILL DOWN from a batch row into that worker: point the selector at them, leave
  // the batch view, and run a plain single-worker calc for the SAME period — so the
  // full single-worker detail (breakdown, working-hours, deductions, payslip/share)
  // opens. Split stays off (the batch is flat), matching the row it launched from.
  function drillDown(wid: string) {
    setWorkerId(wid);
    setBatchResult(null);
    setSplitEnabled(false);
    calc.mutate(wid);
  }

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

  // AUTO-OPEN split when the computed worker/period exceeds 236 ATTENDANCE hours.
  // Runs only AFTER the working-hours data has LOADED for the pinned result — the
  // hours total is unavailable pre-calc, and gating on load keeps the under-236
  // flat path byte-for-byte identical (no state churn there). The ref keys the
  // firing to the exact worker+period so it fires once per crossing and does not
  // re-enable if the manager toggles split back OFF on the same data.
  useEffect(() => {
    // Split/auto-open is SINGLE-WORKER only — never run it for the "All workers"
    // sentinel (the batch path has no split controls at all).
    if (isBatch) return;
    // Need a pinned result whose working-hours have finished loading.
    if (!result || !resultWorkerId || !resultPeriod) return;
    if (workingHours.isLoading || !workingHours.data) return;
    const identity = `${resultWorkerId}|${resultPeriod.from}|${resultPeriod.to}`;
    if (autoOpenedForRef.current === identity) return; // already handled this crossing
    if (!shouldAutoOpenSplit(attendanceHours(whRows), SPLIT_THRESHOLD_DEFAULT, splitEnabled)) {
      return;
    }
    autoOpenedForRef.current = identity;
    setSplitEnabled(true);
    setSplitThreshold(String(SPLIT_THRESHOLD_DEFAULT)); // pre-fill (contractor rate NOT filled)
    setSplitAutoOpened(true);
  }, [
    result,
    resultWorkerId,
    resultPeriod,
    workingHours.isLoading,
    workingHours.data,
    whRows,
    splitEnabled,
    isBatch,
  ]);

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

  // Download the WHOLE batch table as a PDF or .xlsx via an authed blob fetch (the
  // same pattern as the payslip PDF: apiUrl + bearer → blob → object URL). The batch
  // export uses the table's own period; scope is server-derived from the caller.
  async function downloadBatch(kind: 'pdf' | 'xlsx') {
    if (!batchResult) return;
    setBatchExporting(kind);
    setError(null);
    try {
      const path = kind === 'pdf' ? '/reports/payroll-batch.pdf' : '/reports/payroll-batch.xlsx';
      const url = apiUrl(path, {
        from: batchResult.periodStart,
        to: batchResult.periodEnd,
        lang: i18n.language,
      });
      const token = await bearerToken();
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      // Force a download with the mirrored backend filename (xlsx especially — a new
      // tab can't render a spreadsheet).
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = payrollExportFilename(batchResult.periodStart, batchResult.periodEnd, kind);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBatchExporting(null);
    }
  }

  // Share the batch: EMAIL (manager-typed recipient) or WHATSAPP (manager-typed phone).
  const batchShare = useMutation({
    mutationFn: async (channel: 'email' | 'whatsapp') => {
      if (!batchResult) throw new Error('no-batch');
      const period = { from: batchResult.periodStart, to: batchResult.periodEnd, lang };
      if (channel === 'email') {
        await payrollApi.email({ ...period, email: batchEmailTo.trim() });
        return { channel } as const;
      }
      const link = await payrollApi.whatsappLink({ ...period, phone: batchPhone.trim() });
      return { channel, link } as const;
    },
    onSuccess: (res) => {
      setError(null);
      if (res.channel === 'email') {
        setBatchEmailOpen(false);
        setSuccess(t('salary.batchSharedEmail', { email: batchEmailTo.trim() }));
      } else {
        setBatchWhatsappOpen(false);
        const msg = t('salary.batchWhatsappMessage', { url: res.link.url });
        window.open(
          `https://wa.me/${res.link.phone}?text=${encodeURIComponent(msg)}`,
          '_blank',
        );
        setSuccess(t('salary.batchSharedWhatsapp'));
      }
    },
    onError: (e, channel) => {
      setSuccess(null);
      setError(batchShareErrorMessage(e, channel));
    },
  });

  /** Batch-share error → localized copy. 503 = SMTP not configured; 400 = a bad
   *  typed email/phone the server rejected. */
  function batchShareErrorMessage(e: unknown, channel: 'email' | 'whatsapp'): string {
    if (e instanceof ApiError) {
      if (channel === 'email' && e.status === 503) return t('salary.shareNotConfigured');
      if (e.status === 400) {
        return channel === 'email' ? t('salary.batchBadEmail') : t('salary.batchBadPhone');
      }
    }
    return t('salary.shareFailed');
  }

  function openBatchEmail() {
    setBatchShareMenuOpen(false);
    // Prefill with the logged-in manager's own email (they can edit/replace it).
    setBatchEmailTo(user?.email ?? '');
    setError(null);
    setSuccess(null);
    setBatchEmailOpen(true);
  }
  function openBatchWhatsapp() {
    setBatchShareMenuOpen(false);
    setBatchPhone('');
    setError(null);
    setSuccess(null);
    setBatchWhatsappOpen(true);
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
              {/* "All workers" batch entry — sentinel value, sits at the top of the
                  list just below the empty placeholder. */}
              <option value={ALL_WORKERS}>{t('salary.allWorkers')}</option>
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
            // Batch Calculate is NOT blocked by contractorRateMissing (split is
            // single-worker only); the single-worker guard is unchanged.
            disabled={
              !workerId ||
              calc.isPending ||
              batchCalc.isPending ||
              (!isBatch && contractorRateMissing)
            }
            aria-busy={calc.isPending || batchCalc.isPending}
            onClick={runCalculate}
          >
            {calc.isPending || batchCalc.isPending ? (
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

        {/* HOURS-SPLIT controls — SINGLE-WORKER ONLY. Hidden entirely for the
            "All workers" batch run (split never applies to the batch). The inner
            markup below is byte-for-byte the pre-batch single-worker section. */}
        {!isBatch ? (
        <>
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
              {/* The validation copy lives on its OWN full-width line below the row
                  (see below) so the fields stay side-by-side and the hint text can
                  stretch on one line instead of wrapping inside the narrow field. */}
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
              </div>
            </>
          ) : null}
        </div>

        {/* Contractor-rate required validation — full-width line so the copy
            stretches on one line (RTL-safe; danger color mirrors the field). */}
        {contractorRateMissing ? (
          <p
            id="split-contractor-rate-hint"
            style={{
              color: 'var(--sl-color-danger)',
              fontSize: 'var(--sl-font-size-sm, 0.85em)',
              marginBlockStart: 'var(--sl-space-1)',
              marginBlockEnd: 0,
            }}
          >
            {t('salary.splitContractorRateRequired')}
          </p>
        ) : null}

        {/* Auto-open hint (Option A): shown once when split was auto-enabled
            because the worker exceeded 236 ATTENDANCE hours. Muted-hint idiom,
            RTL-safe logical spacing. */}
        {splitEnabled && splitAutoOpened ? (
          <p
            className="muted"
            style={{
              fontSize: 'var(--sl-font-size-sm, 0.85em)',
              marginBlockStart: 'var(--sl-space-2)',
              marginBlockEnd: 0,
            }}
          >
            {t('salary.splitAutoOpened')}
          </p>
        ) : null}
        </>
        ) : null}
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

      {/* BATCH ("All workers") table — display-only, shown in place of the
          single-worker result card when a batch run exists. 7 columns:
          Worker | Period (from–to) | Work hours | Hour price | Gross | Deductions | Net.
          NO per-row payslip/share (that stays single-worker). Reuses the
          .table-wrap/.data classes; money/number columns align to the end (RTL-safe
          logical alignment). */}
      {batchResult ? (
        <div className="card sl-fade-in">
          <div className="page-header" style={{ marginBlockEnd: 'var(--sl-space-3)' }}>
            <h3 className="subsection-title" style={{ margin: 0 }}>
              {t('salary.allWorkers')}
            </h3>
            <div className="header-spacer" />
          </div>

          {/* EXPORT + SHARE action bar — reverses the earlier display-only decision
              for the batch (intended). PDF + real .xlsx download the whole table;
              Share → Email / WhatsApp. Sits above the table; RTL-safe (logical gaps,
              menu opens from the inline-start). */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--sl-space-2)',
              alignItems: 'center',
              marginBlockEnd: 'var(--sl-space-3)',
            }}
          >
            <button
              className="btn"
              disabled={batchExporting !== null || batchResult.rows.length === 0}
              aria-busy={batchExporting === 'pdf'}
              onClick={() => void downloadBatch('pdf')}
            >
              {batchExporting === 'pdf' ? t('workers.uploading') : t('salary.batchExportPdf')}
            </button>
            <button
              className="btn"
              disabled={batchExporting !== null || batchResult.rows.length === 0}
              aria-busy={batchExporting === 'xlsx'}
              onClick={() => void downloadBatch('xlsx')}
            >
              {batchExporting === 'xlsx' ? t('workers.uploading') : t('salary.batchExportExcel')}
            </button>

            <div ref={batchShareMenuRef} style={{ position: 'relative' }}>
              <button
                className="btn btn-primary"
                disabled={batchShare.isPending || batchResult.rows.length === 0}
                aria-haspopup="menu"
                aria-expanded={batchShareMenuOpen}
                onClick={() => setBatchShareMenuOpen((o) => !o)}
              >
                <span aria-hidden style={{ marginInlineEnd: 'var(--sl-space-1)' }}>
                  ⤴
                </span>
                {batchShare.isPending ? t('salary.sending') : t('salary.share')}
              </button>

              {batchShareMenuOpen ? (
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
                    onClick={openBatchEmail}
                  >
                    {t('salary.sendEmail')}
                  </button>
                  <button
                    className="btn btn-ghost"
                    role="menuitem"
                    style={{ justifyContent: 'flex-start', textAlign: 'start' }}
                    onClick={openBatchWhatsapp}
                  >
                    {t('salary.sendWhatsapp')}
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          {/* Truncation note — never hidden: some active workers may be omitted
              (no configured wage). Count comes straight from the server. */}
          {batchResult.skippedCount > 0 ? (
            <p className="muted" style={{ marginBlockStart: 0, marginBlockEnd: 'var(--sl-space-2)' }}>
              {t('salary.batchSkipped', { count: batchResult.skippedCount })}
            </p>
          ) : null}

          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('salary.batchWorker')}</th>
                  <th>{t('salary.batchPeriod')}</th>
                  <th style={{ textAlign: 'end' }}>{t('salary.batchHours')}</th>
                  <th style={{ textAlign: 'end' }}>{t('salary.batchHourPrice')}</th>
                  <th style={{ textAlign: 'end' }}>{t('salary.batchGross')}</th>
                  <th style={{ textAlign: 'end' }}>{t('salary.batchDeductions')}</th>
                  <th style={{ textAlign: 'end' }}>{t('salary.batchNet')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {batchResult.rows.map((row, i) => {
                  // Resolve the display name from the already-loaded workers list;
                  // fall back to the raw id if the worker isn't in the current page.
                  const w = workers.data?.items.find((x) => x.id === row.workerId);
                  const name = w ? `${w.firstName} ${w.lastName}`.trim() : row.workerId;
                  // Fixed-MONTHLY rows: mark the rate as informational (gross is the
                  // fixed amount, NOT rate×hours) — never blank the cell.
                  const isMonthly = row.mode === 'fixed';
                  return (
                    <tr key={`${row.workerId}-${i}`}>
                      <td>{name}</td>
                      <td>
                        {formatDate(batchResult.periodStart)} – {formatDate(batchResult.periodEnd)}
                      </td>
                      <td style={{ textAlign: 'end' }}>{row.totalHours}</td>
                      <td style={{ textAlign: 'end' }}>
                        {formatCurrency(row.hourlyWage, row.currency)}
                        {isMonthly ? (
                          <sup
                            style={{ marginInlineStart: '0.15em' }}
                            title={t('salary.batchMonthlyMarker')}
                            aria-label={t('salary.batchMonthlyMarker')}
                          >
                            *
                          </sup>
                        ) : null}
                      </td>
                      <td style={{ textAlign: 'end' }}>
                        {formatCurrency(row.gross, row.currency)}
                      </td>
                      <td style={{ textAlign: 'end' }}>
                        {formatCurrency(row.deductionsTotal, row.currency)}
                      </td>
                      <td
                        style={{
                          textAlign: 'end',
                          // Same negative-net danger treatment as the single-calc path.
                          ...(row.net < 0 ? { color: 'var(--sl-color-danger)' } : {}),
                        }}
                      >
                        {formatCurrency(row.net, row.currency)}
                      </td>
                      <td style={{ textAlign: 'end' }}>
                        <button
                          className="btn btn-sm"
                          disabled={calc.isPending}
                          onClick={() => drillDown(row.workerId)}
                        >
                          {t('salary.batchDetails')}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Legend for the monthly marker — only when at least one fixed row is
              present, so managers aren't misled that gross = rate × hours. */}
          {batchResult.rows.some((r) => r.mode === 'fixed') ? (
            <p className="muted" style={{ marginBlockStart: 'var(--sl-space-2)' }}>
              {t('salary.batchMonthlyLegend')}
            </p>
          ) : null}
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

      {/* BATCH share — EMAIL modal. Recipient is manager-TYPED, prefilled with the
          manager's own email. Submit is blocked until a non-empty value is entered
          (the server still validates the address; a 400 surfaces as batchBadEmail). */}
      {batchEmailOpen ? (
        <div className="modal-overlay" onClick={() => setBatchEmailOpen(false)}>
          <div
            className="modal"
            style={{ maxWidth: 460 }}
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3 className="subsection-title" style={{ margin: 0 }}>
                {t('salary.batchEmailTitle')}
              </h3>
            </div>
            <p className="muted" style={{ marginBlockStart: 0 }}>
              {t('salary.batchEmailHint')}
            </p>
            <div className="field">
              <label htmlFor="batch-email-to">{t('salary.batchEmailLabel')}</label>
              <input
                id="batch-email-to"
                className="input"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="name@example.com"
                value={batchEmailTo}
                onChange={(e) => setBatchEmailTo(e.target.value)}
              />
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setBatchEmailOpen(false)}>
                {t('common.cancel')}
              </button>
              <button
                className="btn btn-primary"
                disabled={batchShare.isPending || batchEmailTo.trim() === ''}
                aria-busy={batchShare.isPending}
                onClick={() => batchShare.mutate('email')}
              >
                {batchShare.isPending ? t('salary.sending') : t('salary.confirmSend')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* BATCH share — WHATSAPP modal. Phone is manager-TYPED (not a worker's). The
          server normalizes it and mints a signed link; the FE then opens WhatsApp. */}
      {batchWhatsappOpen ? (
        <div className="modal-overlay" onClick={() => setBatchWhatsappOpen(false)}>
          <div
            className="modal"
            style={{ maxWidth: 460 }}
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3 className="subsection-title" style={{ margin: 0 }}>
                {t('salary.batchWhatsappTitle')}
              </h3>
            </div>
            <p className="muted" style={{ marginBlockStart: 0 }}>
              {t('salary.batchWhatsappHint')}
            </p>
            <div className="field">
              <label htmlFor="batch-phone">{t('salary.batchWhatsappLabel')}</label>
              <input
                id="batch-phone"
                className="input"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+972 50 000 0000"
                value={batchPhone}
                onChange={(e) => setBatchPhone(e.target.value)}
              />
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setBatchWhatsappOpen(false)}>
                {t('common.cancel')}
              </button>
              <button
                className="btn btn-primary"
                disabled={batchShare.isPending || batchPhone.trim() === ''}
                aria-busy={batchShare.isPending}
                onClick={() => batchShare.mutate('whatsapp')}
              >
                {batchShare.isPending ? t('salary.sending') : t('salary.confirmSend')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
