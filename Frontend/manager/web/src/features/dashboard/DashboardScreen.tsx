/** Dashboard (FR-MGR-DASH): all-sites default, site + date-range filter, workforce
 *  + finance rollups with manual revenue input, and a simple per-site bar chart. */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { dashboardApi } from '../../lib/api/endpoints';
import { qk } from '../../lib/api/queryKeys';
import { useSitesList } from '../../lib/api/hooks';
import { DataState } from '../../components/ui';
import { currentMonthRange, formatCurrency, formatNumber, formatDate, toDateInput, dateInputToISO } from '../../lib/format';

export function DashboardScreen() {
  const { t } = useTranslation();
  const sites = useSitesList();
  const initial = useMemo(currentMonthRange, []);
  const [siteId, setSiteId] = useState('');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [revenue, setRevenue] = useState(0);

  const params = { siteId: siteId || undefined, from, to, revenue, currency: 'ILS' };
  const query = useQuery({
    queryKey: qk.dashboard(params),
    queryFn: () => dashboardApi.get(params),
  });

  const data = query.data;
  const currency = data?.finance.currency ?? 'ILS';

  const maxPerSite = useMemo(() => {
    const counts = data?.workers.workersPerSite.map((w) => w.workerCount) ?? [];
    return Math.max(1, ...counts);
  }, [data]);

  return (
    <div>
      <div className="page-header">
        <h1 className="section-title" style={{ margin: 0 }}>
          {t('dashboard.title')}
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
            <label>{t('dashboard.revenue')}</label>
            <input
              className="input"
              type="number"
              min={0}
              value={revenue}
              onChange={(e) => setRevenue(Number(e.target.value) || 0)}
            />
          </div>
        </div>
      </div>

      <DataState isLoading={query.isLoading} error={query.error}>
        {data ? (
          <>
            <h2 className="subsection-title" style={{ marginBlockStart: 'var(--sl-space-6)' }}>
              {t('dashboard.workforce')}
            </h2>
            <div className="grid grid-kpi">
              <Kpi label={t('dashboard.workers')} value={formatNumber(data.workers.amountOfWorkers)} />
              <Kpi label={t('dashboard.attendanceDays')} value={formatNumber(data.workers.attendanceDays)} />
              <Kpi label={t('dashboard.vacationDays')} value={formatNumber(data.workers.vacationDays)} />
              <Kpi label={t('dashboard.diseaseDays')} value={formatNumber(data.workers.diseaseDays)} />
              <Kpi label={t('dashboard.workHours')} value={formatNumber(data.workers.totalWorkHours)} />
              <Kpi label={t('dashboard.loans')} value={formatCurrency(data.workers.loansTotal, currency)} />
              <Kpi
                label={t('dashboard.advances')}
                value={formatCurrency(data.workers.advancePaymentsTotal, currency)}
              />
            </div>

            <h2 className="subsection-title" style={{ marginBlockStart: 'var(--sl-space-6)' }}>
              {t('dashboard.finance')}
            </h2>
            <div className="grid grid-kpi">
              <Kpi label={t('dashboard.salaryTotal')} value={formatCurrency(data.finance.salaryTotal, currency)} />
              <Kpi label={t('dashboard.revenue')} value={formatCurrency(data.finance.profitAndLoss.revenue, currency)} />
              <Kpi
                label={t('dashboard.netProfit')}
                value={formatCurrency(data.finance.profitAndLoss.netProfit, currency)}
                tone={data.finance.profitAndLoss.netProfit >= 0 ? 'success' : 'danger'}
              />
            </div>

            {data.workers.workersPerSite.length > 0 ? (
              <div className="card" style={{ marginBlockStart: 'var(--sl-space-4)' }}>
                <h3 className="subsection-title">{t('dashboard.workersPerSite')}</h3>
                <div className="bars">
                  {data.workers.workersPerSite.map((w) => (
                    <div className="bar-row" key={w.siteId}>
                      <span>{w.siteName}</span>
                      <span className="bar-track">
                        <span
                          className="bar-fill"
                          style={{ width: `${(w.workerCount / maxPerSite) * 100}%` }}
                        />
                      </span>
                      <span>{formatNumber(w.workerCount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <p className="muted" style={{ marginBlockStart: 'var(--sl-space-4)' }}>
              {t('dashboard.computedAt')}: {formatDate(data.computedAt)}
            </p>
          </>
        ) : null}
      </DataState>
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
