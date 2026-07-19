/** Salary (FR-MGR-SRE): calculate via /salary/calculate (mode + rate resolved
 *  server-side), show the itemized breakdown, and download the payslip PDF. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { SalaryResult } from '@sitelink/shared';
import { salaryApi, payslipApi } from '../../lib/api/endpoints';
import { apiUrl, bearerToken, ApiError } from '../../lib/api/client';
import { useWorkersList } from '../../lib/api/hooks';
import { currentMonthRange, formatCurrency, formatDate, toDateInput, dateInputToISO } from '../../lib/format';
import i18n from '../../i18n';

export function SalaryScreen() {
  const { t } = useTranslation();
  const workers = useWorkersList();
  const range = useMemo(currentMonthRange, []);
  const [workerId, setWorkerId] = useState('');
  const [periodStart, setPeriodStart] = useState(range.from);
  const [periodEnd, setPeriodEnd] = useState(range.to);
  const [result, setResult] = useState<SalaryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

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
      const body = { workerId, from: periodStart, to: periodEnd, lang };
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
    mutationFn: () => salaryApi.calculate({ workerId, periodStart, periodEnd }),
    onSuccess: (r) => {
      setResult(r);
      setError(null);
      setSuccess(null);
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : String(e));
      setResult(null);
      setSuccess(null);
    },
  });

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
            disabled={!workerId || calc.isPending}
            onClick={() => calc.mutate()}
          >
            {t('salary.calculate')}
          </button>
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
        <div className="card">
          <div className="page-header" style={{ marginBlockEnd: 'var(--sl-space-3)' }}>
            <h3 className="subsection-title" style={{ margin: 0 }}>
              {t('salary.result')}
            </h3>
            <div className="header-spacer" />
            <span className="muted">
              {t('salary.engineVersion')}: {result.engineVersion}
            </span>
          </div>
          <div className="grid grid-kpi" style={{ marginBlockEnd: 'var(--sl-space-4)' }}>
            <div className="kpi">
              <div className="kpi-label">{t('salary.gross')}</div>
              <div className="kpi-value">{formatCurrency(result.gross, result.currency)}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">{t('payment.calcMode')}</div>
              <div className="kpi-value" style={{ fontSize: 'var(--sl-font-size-lg)' }}>
                {result.mode === 'israeli-labor-law'
                  ? t('payment.israeliLaborLaw')
                  : t('payment.fixed')}
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
