/**
 * Back Office Dashboard (FR-BO-1). Three panels, all from REAL Stage B endpoints:
 *  - System status chips: root-mounted GET /health (liveness) + GET /health/db
 *    (200 {db:'up',latencyMs} or 503 {status:'degraded',db:'down'} — non-200 handled).
 *  - P&L KPIs: GET /backoffice/profit-loss (current month, business-wide).
 *  - Users overview: count derived from GET /backoffice/users.
 *
 *  A segmented "Data | Graphics" toggle (persisted to localStorage) presents the
 *  SAME already-fetched payloads either as the existing DATA view (chips/KPIs) or
 *  a GRAPHICS view of dependency-free inline-SVG charts. Chart colors come from
 *  @sitelink/ui-tokens CSS custom props (dark-mode) and RTL is honoured via logical
 *  props + mirrored bar order / legend flow.
 */
import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { backOfficeApi, healthApi, type BackOfficeUser } from '../../lib/api/endpoints';
import { qk } from '../../lib/api/queryKeys';
import { Chip, Kpi } from '../../components/ui';
import { dirForLocale } from '../../i18n';
import { currentMonthRange, formatCurrency, formatNumber } from '../../lib/format';
import type { ProfitLoss } from '@sitelink/shared';

const CURRENCY = 'ILS';

type DashView = 'data' | 'graphics';
const VIEW_STORAGE_KEY = 'sitelink.bo.dashboard.view';

function initialView(): DashView {
  return localStorage.getItem(VIEW_STORAGE_KEY) === 'graphics' ? 'graphics' : 'data';
}

export function DashboardScreen() {
  const { t } = useTranslation();
  const range = useMemo(currentMonthRange, []);
  const [view, setViewState] = useState<DashView>(initialView);

  const setView = useCallback((next: DashView) => {
    localStorage.setItem(VIEW_STORAGE_KEY, next);
    setViewState(next);
  }, []);

  const liveness = useQuery({
    queryKey: [...qk.health, 'live'],
    queryFn: ({ signal }) => healthApi.liveness(signal),
    refetchInterval: 30_000,
  });
  const db = useQuery({
    queryKey: [...qk.health, 'db'],
    queryFn: ({ signal }) => healthApi.db(signal),
    refetchInterval: 30_000,
  });

  const pnlParams = { from: range.from, to: range.to, revenue: 0, currency: CURRENCY };
  const pnl = useQuery({
    queryKey: qk.boProfitLoss(pnlParams),
    queryFn: () => backOfficeApi.profitLoss(pnlParams),
  });

  const users = useQuery({ queryKey: qk.boUsers, queryFn: () => backOfficeApi.users() });

  // Liveness: any 2xx body means the API answered. Errors → offline.
  const apiOnline = liveness.data?.status === 200 && !liveness.isError;
  // DB: /health/db is 200 when up; 503 (still a parsed body) when down.
  const dbUp = db.data?.status === 200 && db.data.body?.db === 'up' && !db.isError;
  const dbLatency = db.data?.body?.latencyMs;
  const uptime = liveness.data?.body?.uptimeSeconds;

  const currency = pnl.data?.currency ?? CURRENCY;
  const totalUsers = users.data?.length ?? 0;
  const lockedUsers = users.data?.filter((u) => u.isLockedOut).length ?? 0;

  const systemStatus = (
    <div className="card">
      <h3 className="subsection-title">{t('dashboard.systemStatus')}</h3>
      <div className="status-row">
        <Chip tone={apiOnline ? 'success' : 'danger'}>
          {apiOnline ? t('dashboard.apiUp') : t('dashboard.apiDown')}
        </Chip>
        <Chip tone={dbUp ? 'success' : 'danger'}>
          {dbUp ? t('dashboard.dbUp') : t('dashboard.dbDown')}
        </Chip>
        {dbUp && dbLatency != null ? (
          <Chip tone="info">
            {t('dashboard.latency')}: {formatNumber(dbLatency)} ms
          </Chip>
        ) : null}
        {apiOnline && uptime != null ? (
          <Chip tone="neutral">
            {t('dashboard.uptime')}: {formatNumber(uptime)} s
          </Chip>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="deck">
      <div className="page-header">
        <h1 className="section-title" style={{ margin: 0 }}>
          {t('dashboard.title')}
        </h1>
        <span className="header-spacer" />
        <div className="segmented" role="group" aria-label={t('dashboard.title')}>
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
      </div>

      {/* System status (shown in both views) */}
      {systemStatus}

      {view === 'data' ? (
        <DataView
          pnl={pnl}
          users={users}
          currency={currency}
          totalUsers={totalUsers}
          lockedUsers={lockedUsers}
        />
      ) : (
        <GraphicsView pnlData={pnl.data} usersData={users.data} currency={currency} />
      )}
    </div>
  );
}

type PnlQuery = { isLoading: boolean; error: unknown; data?: ProfitLoss };
type UsersQuery = { isLoading: boolean; error: unknown; data?: BackOfficeUser[] };

/** DATA view: the original chips/KPI content, unchanged. */
function DataView({
  pnl,
  users,
  currency,
  totalUsers,
  lockedUsers,
}: {
  pnl: PnlQuery;
  users: UsersQuery;
  currency: string;
  totalUsers: number;
  lockedUsers: number;
}) {
  const { t } = useTranslation();
  return (
    <>
      {/* Profit & Loss overview */}
      <div className="card">
        <div className="page-header" style={{ marginBlockEnd: 'var(--sl-space-3)' }}>
          <h3 className="subsection-title" style={{ margin: 0 }}>
            {t('dashboard.financeOverview')}
          </h3>
          <div className="header-spacer" />
          <span className="muted">{t('dashboard.period')}</span>
        </div>
        {pnl.isLoading ? (
          <div className="loading-state">{t('common.loading')}</div>
        ) : pnl.error ? (
          <div className="banner banner-danger">
            {pnl.error instanceof Error ? pnl.error.message : String(pnl.error)}
          </div>
        ) : pnl.data ? (
          <div className="grid grid-kpi">
            <Kpi label={t('dashboard.revenue')} value={formatCurrency(pnl.data.revenue, currency)} />
            <Kpi
              label={t('dashboard.salaryCost')}
              value={formatCurrency(pnl.data.salaryCost, currency)}
            />
            <Kpi
              label={t('dashboard.netProfit')}
              value={formatCurrency(pnl.data.netProfit, currency)}
              tone={pnl.data.netProfit >= 0 ? 'success' : 'danger'}
            />
          </div>
        ) : null}
      </div>

      {/* Users overview */}
      <div className="card">
        <h3 className="subsection-title">{t('dashboard.usersOverview')}</h3>
        {users.isLoading ? (
          <div className="loading-state">{t('common.loading')}</div>
        ) : users.error ? (
          <div className="banner banner-danger">
            {users.error instanceof Error ? users.error.message : String(users.error)}
          </div>
        ) : (
          <div className="grid grid-kpi">
            <Kpi label={t('dashboard.totalUsers')} value={formatNumber(totalUsers)} />
            <Kpi
              label={t('dashboard.lockedUsers')}
              value={formatNumber(lockedUsers)}
              tone={lockedUsers > 0 ? 'danger' : undefined}
            />
          </div>
        )}
      </div>
    </>
  );
}

/** GRAPHICS view: dependency-free inline-SVG charts from the SAME already-fetched
 *  payloads. Colors are @sitelink/ui-tokens CSS custom props (dark-mode aware); RTL
 *  mirrors bar order / legend flow.
 *  - profitLoss.{revenue,salaryCost,loansCost,advancesCost,netProfit} → BAR chart
 *  - users[] aggregated by role                                       → BAR chart
 *  - users[] active vs locked (isLockedOut)                           → DONUT chart */
function GraphicsView({
  pnlData,
  usersData,
  currency,
}: {
  pnlData?: ProfitLoss;
  usersData?: BackOfficeUser[];
  currency: string;
}) {
  const { t, i18n } = useTranslation();
  const rtl = dirForLocale(i18n.language) === 'rtl';

  const financeBars: Datum[] = pnlData
    ? [
        { label: t('dashboard.revenue'), value: Math.max(0, pnlData.revenue), color: 'var(--sl-color-success)' },
        { label: t('dashboard.salaryCost'), value: Math.max(0, pnlData.salaryCost), color: 'var(--sl-color-accent)' },
        { label: t('dashboard.loansCost'), value: Math.max(0, pnlData.loansCost), color: 'var(--sl-color-info)' },
        { label: t('dashboard.advancesCost'), value: Math.max(0, pnlData.advancesCost), color: 'var(--sl-color-warning)' },
        {
          label: t('dashboard.netProfit'),
          value: Math.max(0, pnlData.netProfit),
          color: pnlData.netProfit >= 0 ? 'var(--sl-color-success)' : 'var(--sl-color-danger)',
        },
      ]
    : [];

  const roleBars: Datum[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const u of usersData ?? []) counts.set(u.role, (counts.get(u.role) ?? 0) + 1);
    return [...counts.entries()].map(([role, value]) => ({
      label: t(`roles.${role}`, role),
      value,
      color: 'var(--sl-color-accent)',
    }));
  }, [usersData, t]);

  const statusSlices: Datum[] = useMemo(() => {
    const all = usersData ?? [];
    const locked = all.filter((u) => u.isLockedOut).length;
    const active = all.length - locked;
    return [
      { label: t('dashboard.activeUsers'), value: active, color: 'var(--sl-color-success)' },
      { label: t('dashboard.lockedUsers'), value: locked, color: 'var(--sl-color-danger)' },
    ];
  }, [usersData, t]);

  return (
    <div className="chart-grid">
      {financeBars.length > 0 ? (
        <div className="card">
          <h3 className="subsection-title">{t('dashboard.financeChart')}</h3>
          <BarChart
            data={financeBars}
            rtl={rtl}
            formatValue={(v) => formatCurrency(v, currency)}
            ariaLabel={`${t('dashboard.financeChart')}. ${t('dashboard.chartFinanceDesc')}`}
          />
        </div>
      ) : null}

      {roleBars.length > 0 ? (
        <div className="card">
          <h3 className="subsection-title">{t('dashboard.usersRoleChart')}</h3>
          <BarChart
            data={roleBars}
            rtl={rtl}
            formatValue={(v) => formatNumber(v)}
            ariaLabel={`${t('dashboard.usersRoleChart')}. ${t('dashboard.chartUsersRoleDesc')}`}
          />
        </div>
      ) : null}

      <div className="card">
        <h3 className="subsection-title">{t('dashboard.usersStatusChart')}</h3>
        <DonutChart
          data={statusSlices}
          totalLabel={t('dashboard.chartTotal')}
          formatValue={(v) => formatNumber(v)}
          emptyLabel={t('dashboard.chartNoData')}
          ariaLabel={`${t('dashboard.usersStatusChart')}. ${t('dashboard.chartUsersStatusDesc')}`}
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
 *  Under RTL the bar order is mirrored so the chart reads right-to-left.
 *  `role="img"` + `aria-label` give screen readers a summary. Geometry is guarded
 *  with max=Math.max(1,…) so an all-zero payload never yields NaN coordinates. */
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
  const H = 180;
  const padTop = 8;
  const padBottom = 40; // room for category labels
  const plotH = H - padTop - padBottom;
  const n = data.length;
  const slot = W / Math.max(1, n);
  const barW = Math.min(48, slot * 0.6);
  const max = Math.max(1, ...data.map((d) => d.value));
  const baseY = padTop + plotH;

  const items = rtl ? [...data].reverse() : data;

  return (
    <svg
      className="svg-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={ariaLabel}
      preserveAspectRatio="xMidYMid meet"
    >
      <line x1={0} y1={baseY} x2={W} y2={baseY} stroke="var(--sl-color-border)" strokeWidth={1} />
      {items.map((d, i) => {
        const h = (d.value / max) * plotH;
        const cx = slot * i + slot / 2;
        const x = cx - barW / 2;
        const y = baseY - h;
        return (
          <g key={`${d.label}-${i}`}>
            <rect className="svg-bar" x={x} y={y} width={barW} height={h} rx={3} fill={d.color}>
              <title>{`${d.label}: ${formatValue(d.value)}`}</title>
            </rect>
            <text
              x={cx}
              y={y - 4}
              textAnchor="middle"
              className="svg-value"
              fill="var(--sl-color-text-primary)"
            >
              {formatValue(d.value)}
            </text>
            <text
              x={cx}
              y={baseY + 14}
              textAnchor="middle"
              className="svg-label"
              fill="var(--sl-color-text-secondary)"
            >
              {truncate(d.label, 12)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** SVG donut chart (no dependency) using stroke-dasharray on circle arcs, plus a
 *  legend. The ring is direction-agnostic; the legend flows with the document
 *  direction (flex + logical gap) so it flips correctly under RTL. A zero total
 *  renders the track ring and an empty-label legend (never NaN dash lengths). */
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
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--sl-color-surface-alt)" strokeWidth={stroke} />
        {total > 0
          ? arcs.map((a, i) => (
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
                transform={`rotate(${-90 + a.rotate} ${cx} ${cy})`}
              />
            ))
          : null}
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
