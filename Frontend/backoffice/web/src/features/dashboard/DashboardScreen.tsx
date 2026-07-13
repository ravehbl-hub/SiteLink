/**
 * Back Office Dashboard (FR-BO-1). Three panels, all from REAL Stage B endpoints:
 *  - System status chips: root-mounted GET /health (liveness) + GET /health/db
 *    (200 {db:'up',latencyMs} or 503 {status:'degraded',db:'down'} — non-200 handled).
 *  - P&L KPIs: GET /backoffice/profit-loss (current month, business-wide).
 *  - Users overview: count derived from GET /backoffice/users.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { backOfficeApi, healthApi } from '../../lib/api/endpoints';
import { qk } from '../../lib/api/queryKeys';
import { Chip, Kpi } from '../../components/ui';
import { currentMonthRange, formatCurrency, formatNumber } from '../../lib/format';

const CURRENCY = 'ILS';

export function DashboardScreen() {
  const { t } = useTranslation();
  const range = useMemo(currentMonthRange, []);

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

  return (
    <div>
      <div className="page-header">
        <h1 className="section-title" style={{ margin: 0 }}>
          {t('dashboard.title')}
        </h1>
      </div>

      {/* System status */}
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
    </div>
  );
}
