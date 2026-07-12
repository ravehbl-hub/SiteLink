/** Salary (FR-MGR-SRE): calculate via /salary/calculate (mode + rate resolved
 *  server-side), show the itemized breakdown, and download the payslip PDF. */
import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { SalaryResult } from '@sitelink/shared';
import { salaryApi } from '../../lib/api/endpoints';
import { apiUrl, bearerToken } from '../../lib/api/client';
import { useWorkersList } from '../../lib/api/hooks';
import { currentMonthRange, formatCurrency, formatDate, toDateInput, dateInputToISO } from '../../lib/format';
import i18n, { dirForLocale } from '../../i18n';

export function SalaryScreen() {
  const { t } = useTranslation();
  const workers = useWorkersList();
  const range = useMemo(currentMonthRange, []);
  const [workerId, setWorkerId] = useState('');
  const [periodStart, setPeriodStart] = useState(range.from);
  const [periodEnd, setPeriodEnd] = useState(range.to);
  const [result, setResult] = useState<SalaryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const calc = useMutation({
    mutationFn: () => salaryApi.calculate({ workerId, periodStart, periodEnd }),
    onSuccess: (r) => {
      setResult(r);
      setError(null);
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : String(e));
      setResult(null);
    },
  });

  async function downloadPayslip() {
    setDownloading(true);
    setError(null);
    try {
      const url = apiUrl('/reports/payslip.pdf', {
        workerId,
        periodStart,
        periodEnd,
        locale: i18n.language,
        dir: dirForLocale(i18n.language),
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

          <button
            className="btn"
            style={{ marginBlockStart: 'var(--sl-space-3)' }}
            disabled={downloading}
            onClick={() => void downloadPayslip()}
          >
            {downloading ? t('workers.uploading') : t('salary.downloadPayslip')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
