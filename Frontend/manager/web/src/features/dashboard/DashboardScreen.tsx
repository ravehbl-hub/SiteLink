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
import { dirForLocale } from '../../i18n';
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
  // Dashboard rollup is the HEAVY query (~4.9s after the Part 1 optimisation), so
  // it gets the LONGEST cadence: poll every 30s while mounted+visible, never in
  // the background. staleTime 10s so a mount/focus within the interval reuses the
  // cache instead of re-running the expensive rollup.
  const query = useQuery({
    queryKey: qk.dashboard(params),
    queryFn: () => dashboardApi.get(params),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    staleTime: 10_000,
  });

  const data = query.data;
  const currency = data?.finance.currency ?? 'ILS';

  return (
    <div className="deck">
      <div className="page-header">
        <h1 className="section-title" style={{ margin: 0 }}>
          {t('dashboard.title')}
        </h1>
      </div>

      {/* Filter first (top), then the Data/Graphics toggle + its content below it. */}
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

      <div
        className="segmented"
        role="group"
        aria-label={t('dashboard.title')}
        style={{ marginBlockStart: 'var(--sl-space-3)' }}
      >
        <button type="button" aria-pressed={view === 'data'} onClick={() => setView('data')}>
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

/** GRAPHICS view: three dependency-free inline-SVG charts built from the SAME rollup.
 *  - workersPerSite[]                        → vertical SVG BAR chart
 *  - profitAndLoss.{revenue,salaryCost,…}    → vertical SVG BAR chart (revenue vs costs)
 *  - workers.{attendance,vacation,disease}   → SVG DONUT chart
 *  All colors come from @sitelink/ui-tokens CSS custom props, so dark/light theme
 *  and future palette changes are handled by the tokens. RTL is honoured by mirroring
 *  bar order and text-anchor for the active locale direction. */
function GraphicsView({
  data,
  currency,
  t,
}: {
  data: DashboardRollup;
  currency: string;
  t: TFn;
}) {
  const { i18n } = useTranslation();
  const rtl = dirForLocale(i18n.language) === 'rtl';
  const pnl = data.finance.profitAndLoss;

  const financeBars: Datum[] = [
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

  const workforceSlices: Datum[] = [
    { label: t('dashboard.attendanceDays'), value: data.workers.attendanceDays, color: 'var(--sl-color-success)' },
    { label: t('dashboard.vacationDays'), value: data.workers.vacationDays, color: 'var(--sl-color-info)' },
    { label: t('dashboard.diseaseDays'), value: data.workers.diseaseDays, color: 'var(--sl-color-warning)' },
  ];

  const siteBars: Datum[] = data.workers.workersPerSite.map((w) => ({
    label: w.siteName,
    value: w.workerCount,
    color: 'var(--sl-color-accent)',
  }));

  return (
    <div className="chart-grid">
      {siteBars.length > 0 ? (
        <div className="card">
          <h3 className="subsection-title">{t('dashboard.workersPerSite')}</h3>
          <HBarChart
            data={siteBars}
            rtl={rtl}
            formatValue={(v) => formatNumber(v)}
            ariaLabel={`${t('dashboard.workersPerSite')}. ${t('dashboard.chartWorkersDesc')}`}
          />
        </div>
      ) : null}

      <div className="card">
        <h3 className="subsection-title">{t('dashboard.financeChart')}</h3>
        <BarChart
          data={financeBars}
          rtl={rtl}
          formatValue={(v) => formatCurrency(v, currency)}
          ariaLabel={`${t('dashboard.financeChart')}. ${t('dashboard.chartFinanceDesc')}`}
        />
      </div>

      <div className="card">
        <h3 className="subsection-title">{t('dashboard.workforceChart')}</h3>
        <DonutChart
          data={workforceSlices}
          totalLabel={t('dashboard.chartTotal')}
          formatValue={(v) => formatNumber(v)}
          emptyLabel={t('dashboard.chartNoData')}
          ariaLabel={`${t('dashboard.workforceChart')}. ${t('dashboard.chartWorkforceDesc')}`}
        />
      </div>
    </div>
  );
}

interface Datum {
  label: string;
  value: number;
  color: string;
}

/** Vertical SVG bar chart (no dependency). Uses a viewBox so it scales fluidly.
 *  Under RTL the bar order and value/label text-anchor are mirrored so the chart
 *  reads right-to-left. `role="img"` + `aria-label` give screen readers a summary. */
function BarChart({
  data,
  rtl,
  formatValue,
  ariaLabel,
}: {
  data: Datum[];
  rtl: boolean;
  formatValue: (v: number) => string;
  ariaLabel: string;
}) {
  const W = 320;
  const n = data.length;
  const slot = W / Math.max(1, n);
  // Crowd the x-axis? When slots get narrow (many categories, e.g. 12 sites),
  // upright centered labels overlap — angle them and give more bottom room.
  const angled = slot < 46;
  const padTop = 18; // headroom so the top value label never clips the frame/bar
  const padBottom = angled ? 56 : 34; // more room when labels are rotated
  const H = 180;
  const plotH = H - padTop - padBottom;
  const barW = Math.min(48, slot * 0.6);
  const max = Math.max(1, ...data.map((d) => d.value));
  const baseY = padTop + plotH;
  // Truncate to the space available per slot (~5px/char), angled labels get more.
  const maxChars = Math.max(4, Math.floor((angled ? slot * 1.6 : slot) / 5.5));

  const items = rtl ? [...data].reverse() : data;

  return (
    <svg
      className="svg-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={ariaLabel}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* baseline */}
      <line x1={0} y1={baseY} x2={W} y2={baseY} stroke="var(--sl-color-border)" strokeWidth={1} />
      {items.map((d, i) => {
        const h = (d.value / max) * plotH;
        const cx = slot * i + slot / 2;
        const x = cx - barW / 2;
        const y = baseY - h;
        const label = truncate(d.label, maxChars);
        return (
          <g key={`${d.label}-${i}`}>
            <rect className="svg-bar" x={x} y={y} width={barW} height={h} rx={3} fill={d.color}>
              <title>{`${d.label}: ${formatValue(d.value)}`}</title>
            </rect>
            <text
              x={cx}
              y={Math.max(y - 4, 10)}
              textAnchor="middle"
              className="svg-value"
              fill="var(--sl-color-text-primary)"
            >
              {formatValue(d.value)}
            </text>
            {angled ? (
              /* rotate ~40° around the label anchor so long site names don't collide */
              <text
                transform={`rotate(-40 ${cx} ${baseY + 12})`}
                x={cx}
                y={baseY + 12}
                textAnchor="end"
                className="svg-label"
                fill="var(--sl-color-text-secondary)"
              >
                {label}
              </text>
            ) : (
              <text
                x={cx}
                y={baseY + 14}
                textAnchor="middle"
                className="svg-label"
                fill="var(--sl-color-text-secondary)"
              >
                {label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Horizontal bar chart (HTML/CSS, no dependency). Category names sit on their
 *  own row and read in full (no rotation, no aggressive truncation) — the right
 *  choice for many long/RTL names like construction-site labels. Bars grow from
 *  the inline-start (right under RTL) via logical properties, so it mirrors
 *  correctly for Hebrew. Value sits at the row end. */
function HBarChart({
  data,
  rtl: _rtl,
  formatValue,
  ariaLabel,
}: {
  data: Datum[];
  rtl: boolean;
  formatValue: (v: number) => string;
  ariaLabel: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="hbar-chart" role="img" aria-label={ariaLabel}>
      {data.map((d, i) => (
        <div className="hbar-row" key={`${d.label}-${i}`}>
          <span className="hbar-label" title={d.label}>
            {d.label}
          </span>
          <span className="hbar-track">
            <span
              className="hbar-fill"
              style={{ inlineSize: `${(d.value / max) * 100}%`, background: d.color }}
            />
          </span>
          <span className="hbar-value">{formatValue(d.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** SVG donut chart (no dependency) using stroke-dasharray on circle arcs, plus a
 *  legend. The ring is direction-agnostic; the legend flows with the document
 *  direction (flex + logical gap) so it flips correctly under RTL. */
function DonutChart({
  data,
  totalLabel,
  formatValue,
  emptyLabel,
  ariaLabel,
}: {
  data: Datum[];
  totalLabel: string;
  formatValue: (v: number) => string;
  emptyLabel: string;
  ariaLabel: string;
}) {
  const total = data.reduce((s, d) => s + Math.max(0, d.value), 0);
  const size = 160;
  const stroke = 26;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;

  let offset = 0;
  const arcs = total
    ? data.map((d) => {
        const frac = Math.max(0, d.value) / total;
        const dash = frac * circ;
        const arc = { color: d.color, dash, gap: circ - dash, rotate: (offset / circ) * 360 };
        offset += dash;
        return arc;
      })
    : [];

  return (
    <div className="donut-wrap" role="img" aria-label={`${ariaLabel} ${totalLabel}: ${formatValue(total)}.`}>
      <svg className="svg-chart donut" viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        {/* track */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--sl-color-surface-alt)" strokeWidth={stroke} />
        {total > 0 ? (
          arcs.map((a, i) => (
            <circle
              key={i}
              className="svg-arc"
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={a.color}
              strokeWidth={stroke}
              strokeDasharray={`${a.dash} ${a.gap}`}
              // start at 12 o'clock, then rotate by this slice's cumulative offset
              transform={`rotate(${-90 + a.rotate} ${cx} ${cy})`}
            />
          ))
        ) : null}
        <text x={cx} y={cy - 4} textAnchor="middle" className="svg-donut-total" fill="var(--sl-color-text-primary)">
          {formatValue(total)}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" className="svg-label" fill="var(--sl-color-text-secondary)">
          {totalLabel}
        </text>
      </svg>
      <ul className="chart-legend">
        {total > 0 ? (
          data.map((d, i) => (
            <li key={`${d.label}-${i}`}>
              <span className="legend-swatch" style={{ background: d.color }} aria-hidden="true" />
              <span className="legend-label">{d.label}</span>
              <span className="legend-value">{formatValue(d.value)}</span>
            </li>
          ))
        ) : (
          <li className="muted">{emptyLabel}</li>
        )}
      </ul>
    </div>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
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
