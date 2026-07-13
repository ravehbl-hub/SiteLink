/** Profit & Loss (FR-MGR-PNL): all-sites default, site + date-range filter, a
 *  manual revenue input, Calculate via /profit-loss, and a P&L PDF download. */
import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ProfitLoss } from '@sitelink/shared';
import { financeApi } from '../../lib/api/endpoints';
import { apiUrl, bearerToken } from '../../lib/api/client';
import { useSitesList } from '../../lib/api/hooks';
import { currentMonthRange, formatCurrency, formatDate, toDateInput, dateInputToISO } from '../../lib/format';
import i18n from '../../i18n';

const CURRENCY = 'ILS';

export function PnlScreen() {
  const { t } = useTranslation();
  const sites = useSitesList();
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
      financeApi.profitLoss({
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
          {t('pnl.title')}
        </h1>
      </div>

      <div className="card">
        <div className="form-row">
          <div className="field" style={{ minWidth: 200 }}>
            <label>{t('nav.sites')}</label>
            <select className="select" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              <option value="">{t('common.allSites')}</option>
              {sites.data?.items.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
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
          <div className="field">
            <label>{t('pnl.revenue')}</label>
            <input
              className="input"
              type="number"
              min={0}
              value={revenue}
              onChange={(e) => setRevenue(Number(e.target.value) || 0)}
            />
          </div>
          <button className="btn btn-primary" disabled={calc.isPending} onClick={() => calc.mutate()}>
            {t('pnl.calculate')}
          </button>
        </div>
      </div>

      {error ? <div className="banner banner-danger">{error}</div> : null}

      {result ? (
        <div className="card">
          <div className="page-header" style={{ marginBlockEnd: 'var(--sl-space-3)' }}>
            <h3 className="subsection-title" style={{ margin: 0 }}>
              {t('pnl.result')}
            </h3>
            <div className="header-spacer" />
            <span className="muted">
              {formatDate(result.periodStart)} – {formatDate(result.periodEnd)}
            </span>
          </div>

          <div className="grid grid-kpi">
            <Kpi label={t('pnl.revenue')} value={formatCurrency(result.revenue, currency)} />
            <Kpi label={t('pnl.salaryCost')} value={formatCurrency(result.salaryCost, currency)} />
            <Kpi label={t('pnl.loansCost')} value={formatCurrency(result.loansCost, currency)} />
            <Kpi label={t('pnl.advancesCost')} value={formatCurrency(result.advancesCost, currency)} />
            <Kpi label={t('pnl.otherCost')} value={formatCurrency(result.otherCost, currency)} />
            <Kpi
              label={t('pnl.netProfit')}
              value={formatCurrency(result.netProfit, currency)}
              tone={result.netProfit >= 0 ? 'success' : 'danger'}
            />
          </div>

          <button
            className="btn"
            style={{ marginBlockStart: 'var(--sl-space-4)' }}
            disabled={downloading}
            onClick={() => void downloadPdf()}
          >
            {downloading ? t('workers.uploading') : t('pnl.downloadPdf')}
          </button>
        </div>
      ) : (
        <div className="empty-state">{t('pnl.emptyHint')}</div>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'danger';
}) {
  const color =
    tone === 'success'
      ? 'var(--sl-color-success)'
      : tone === 'danger'
        ? 'var(--sl-color-danger)'
        : undefined;
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  );
}
