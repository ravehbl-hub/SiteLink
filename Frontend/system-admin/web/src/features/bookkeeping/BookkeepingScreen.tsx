/**
 * Bookkeeping (FR-BO-4). Mirrors the manager-web P&L pattern: site + date-range +
 * manual-revenue filters → Calculate via GET /backoffice/profit-loss → KPI grid.
 * PDF export streams GET /reports/profit-loss.pdf (ADMIN is within MANAGER_ROLES).
 * Excel export is a DISABLED "coming soon" button — no Excel endpoint this phase.
 *
 * Note: the Back Office surface has no sites-list endpoint, so the site filter is
 * an optional site-id text input (empty = business-wide / all sites).
 */
import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ProfitLoss } from '@sitelink/shared';
import { backOfficeApi } from '../../lib/api/endpoints';
import { apiUrl, bearerToken } from '../../lib/api/client';
import { Kpi } from '../../components/ui';
import {
  currentMonthRange,
  formatCurrency,
  formatDate,
  toDateInput,
  dateInputToISO,
} from '../../lib/format';
import i18n from '../../i18n';

const CURRENCY = 'ILS';

export function BookkeepingScreen() {
  const { t } = useTranslation();
  const range = useMemo(currentMonthRange, []);
  const [siteId, setSiteId] = useState('');
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [revenue, setRevenue] = useState(0);
  const [result, setResult] = useState<ProfitLoss | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const calc = useMutation({
    mutationFn: () =>
      backOfficeApi.profitLoss({
        siteId: siteId || undefined,
        from,
        to,
        revenue,
        currency: CURRENCY,
      }),
    onSuccess: (r) => {
      setResult(r);
      setError(null);
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : String(e));
      setResult(null);
    },
  });

  async function downloadPdf() {
    setDownloading(true);
    setError(null);
    try {
      const url = apiUrl('/reports/profit-loss.pdf', {
        from,
        to,
        siteId: siteId || undefined,
        revenue,
        currency: CURRENCY,
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

  const currency = result?.currency ?? CURRENCY;

  return (
    <div>
      <div className="page-header">
        <h1 className="section-title" style={{ margin: 0 }}>
          {t('bookkeeping.title')}
        </h1>
      </div>

      <div className="card">
        <div className="form-row">
          <div className="field" style={{ minWidth: 200 }}>
            <label>{t('bookkeeping.site')}</label>
            <input
              className="input"
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              placeholder={t('common.allSites')}
            />
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
          <div className="field">
            <label>{t('bookkeeping.revenue')}</label>
            <input
              className="input"
              type="number"
              min={0}
              value={revenue}
              onChange={(e) => setRevenue(Number(e.target.value) || 0)}
            />
          </div>
          <button
            className="btn btn-primary"
            disabled={calc.isPending}
            onClick={() => calc.mutate()}
          >
            {t('bookkeeping.calculate')}
          </button>
        </div>
      </div>

      {error ? <div className="banner banner-danger">{error}</div> : null}

      {result ? (
        <div className="card">
          <div className="page-header" style={{ marginBlockEnd: 'var(--sl-space-3)' }}>
            <h3 className="subsection-title" style={{ margin: 0 }}>
              {t('bookkeeping.result')}
            </h3>
            <div className="header-spacer" />
            <span className="muted">
              {formatDate(result.periodStart)} – {formatDate(result.periodEnd)}
            </span>
          </div>

          <div className="grid grid-kpi">
            <Kpi label={t('bookkeeping.revenue')} value={formatCurrency(result.revenue, currency)} />
            <Kpi label={t('bookkeeping.salaryCost')} value={formatCurrency(result.salaryCost, currency)} />
            <Kpi label={t('bookkeeping.loansCost')} value={formatCurrency(result.loansCost, currency)} />
            <Kpi label={t('bookkeeping.advancesCost')} value={formatCurrency(result.advancesCost, currency)} />
            <Kpi label={t('bookkeeping.otherCost')} value={formatCurrency(result.otherCost, currency)} />
            <Kpi
              label={t('bookkeeping.netProfit')}
              value={formatCurrency(result.netProfit, currency)}
              tone={result.netProfit >= 0 ? 'success' : 'danger'}
            />
          </div>

          <div className="inline" style={{ marginBlockStart: 'var(--sl-space-4)' }}>
            <button className="btn" disabled={downloading} onClick={() => void downloadPdf()}>
              {downloading ? t('bookkeeping.downloading') : t('bookkeeping.downloadPdf')}
            </button>
            {/* Excel export is a future capability — disabled/coming-soon this phase. */}
            <button className="btn" disabled title={t('common.comingSoon')}>
              {t('bookkeeping.exportExcel')}
              <span className="chip chip-neutral">{t('common.comingSoon')}</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="empty-state">{t('bookkeeping.emptyHint')}</div>
      )}
    </div>
  );
}
