/** Dashboard (FR-MGR-DASH): all-sites default, site + date-range filter, workforce
 *  + finance rollups with manual revenue input. Presents the SAME rollup either as
 *  a DATA (KPI/tabular) view or a GRAPHICS (dependency-free inline-SVG chart) view,
 *  toggled by a segmented control whose choice persists in localStorage. */
import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { dashboardApi } from '../../lib/api/endpoints';
import { qk } from '../../lib/api/queryKeys';
import { useSitesList } from '../../lib/api/hooks';
import { DataState } from '../../components/ui';
import type { DashboardRollup } from '@sitelink/shared';
import { currentMonthRange, formatCurrency, formatNumber, formatDate, toDateInput, dateInputToISO } from '../../lib/format';

type DashView = 'data' | 'graphics';
const VIEW_STORAGE_KEY = 'sitelink.dashboard.view';

function initialView(): DashView {
  const stored = localStorage.getItem(VIEW_STORAGE_KEY);
  return stored === 'graphics' ? 'graphics' : 'data';
}

export function DashboardScreen() {
  const { t } = useTranslation();
  const sites = useSitesList();
  const initial = useMemo(currentMonthRange, []);
  const [siteId, setSiteId] = useState('');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [revenue, setRevenue] = useState(0);
  const [view, setViewState] = useState<DashView>(initialView);

  const setView = useCallback((next: DashView) => {
    localStorage.setItem(VIEW_STORAGE_KEY, next);
    setViewState(next);
  }, []);

  const params = { siteId: siteId || undefined, from, to, revenue, currency: 'ILS' };
  const query = useQuery({
    queryKey: qk.dashboard(params),
    queryFn: () => dashboardApi.get(params),
  });

  const data = query.data;
  const currency = data?.finance.currency ?? 'ILS';

  return (
    <div>
      <div className="page-header">
        <h1 className="section-title" style={{ margin: 0 }}>
          {t('dashboard.title')}
        </h1>
        <span className="header-spacer" />
        <div className="segmented" role="group" aria-label={t('dashboard.title')}>
          <button
            type="button"
            aria-pressed={view === 'data'}
            onClick={() => setView('data')}
          >
            {t('dashboard.viewData')}
          </button>
          <button
            type="button"
            aria-pressed={view === 'graphics'}
            onClick={() => setView('graphics')}
          >
            {t('dashboard.viewGraphics')}
          </button>
        </div>
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
            {view === 'data' ? (
              <DataView data={data} currency={currency} t={t} />
            ) : (
              <GraphicsView data={data} currency={currency} t={t} />
            )}
            <p className="muted" style={{ marginBlockStart: 'var(--sl-space-4)' }}>
              {t('dashboard.computedAt')}: {formatDate(data.computedAt)}
            </p>
          </>
        ) : null}
      </DataState>
    </div>
  );
}

type TFn = ReturnType<typeof useTranslation>['t'];

function DataView({
  data,
  currency,
  t,
}: {
  data: DashboardRollup;
  currency: string;
  t: TFn;
}) {
  const maxPerSite = useMemo(() => {
    const counts = data.workers.workersPerSite.map((w) => w.workerCount);
    return Math.max(1, ...counts);
  }, [data]);

  return (
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
    </>
  );
}

/** GRAPHICS view: three dependency-free inline-SVG charts built from the SAME rollup. */
function GraphicsView({
  data,
  currency,
  t,
}: {
  data: DashboardRollup;
  currency: string;
  t: TFn;
}) {
  const pnl = data.finance.profitAndLoss;

  const financeBars = [
    { label: t('dashboard.revenue'), value: Math.max(0, pnl.revenue), color: 'var(--sl-color-success)' },
    { label: t('dashboard.salaryCost'), value: Math.max(0, pnl.salaryCost), color: 'var(--sl-color-accent)' },
    { label: t('finance.loans'), value: Math.max(0, pnl.loansCost), color: 'var(--sl-color-info)' },
    { label: t('finance.advances'), value: Math.max(0, pnl.advancesCost), color: 'var(--sl-color-warning)' },
    {
      label: t('dashboard.netProfit'),
      value: Math.max(0, pnl.netProfit),
      color: pnl.netProfit >= 0 ? 'var(--sl-color-success)' : 'var(--sl-color-danger)',
    },
  ];

  const workforceBars = [
    { label: t('dashboard.attendanceDays'), value: data.workers.attendanceDays, color: 'var(--sl-color-success)' },
    { label: t('dashboard.vacationDays'), value: data.workers.vacationDays, color: 'var(--sl-color-info)' },
    { label: t('dashboard.diseaseDays'), value: data.workers.diseaseDays, color: 'var(--sl-color-warning)' },
  ];

  const siteBars = data.workers.workersPerSite.map((w) => ({
    label: w.siteName,
    value: w.workerCount,
    color: 'var(--sl-color-accent)',
  }));

  return (
    <div className="chart-grid">
      {siteBars.length > 0 ? (
        <div className="card">
          <h3 className="subsection-title">{t('dashboard.workersPerSite')}</h3>
          <BarChart bars={siteBars} formatValue={(v) => formatNumber(v)} />
        </div>
      ) : null}

      <div className="card">
        <h3 className="subsection-title">{t('dashboard.financeChart')}</h3>
        <BarChart bars={financeBars} formatValue={(v) => formatCurrency(v, currency)} />
      </div>

      <div className="card">
        <h3 className="subsection-title">{t('dashboard.workforceChart')}</h3>
        <BarChart bars={workforceBars} formatValue={(v) => formatNumber(v)} />
      </div>
    </div>
  );
}

interface Bar {
  label: string;
  value: number;
  color: string;
}

/** Horizontal bar chart built from HTML + CSS logical properties (no dependency).
 *  Bars use `inline-size` and the flow follows the document direction, so under
 *  html[dir='rtl'] (Hebrew) labels sit on the inline-start and bars grow correctly. */
function BarChart({ bars, formatValue }: { bars: Bar[]; formatValue: (v: number) => string }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div className="bars">
      {bars.map((b, i) => (
        <div className="bar-row" key={`${b.label}-${i}`}>
          <span>{b.label}</span>
          <span className="bar-track">
            <span
              className="bar-fill"
              style={{ inlineSize: `${(b.value / max) * 100}%`, background: b.color }}
            />
          </span>
          <span>{formatValue(b.value)}</span>
        </div>
      ))}
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
