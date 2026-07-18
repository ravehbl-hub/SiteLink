/** Authenticated shell: brand header + tab menu nav (Manager web = tab menu). */
import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTheme } from './ThemeProvider';
import { setLocale, type Locale, LOCALES } from '../i18n';
import i18n from '../i18n';

const TABS: { to: string; key: string }[] = [
  { to: '/', key: 'nav.dashboard' },
  { to: '/workers', key: 'nav.workers' },
  { to: '/attendance', key: 'nav.attendance' },
  { to: '/requests', key: 'nav.requests' },
  { to: '/finance', key: 'nav.finance' },
  { to: '/pnl', key: 'nav.pnl' },
  { to: '/payment', key: 'nav.payment' },
  { to: '/salary', key: 'nav.salary' },
  { to: '/sites', key: 'nav.sites' },
  { to: '/personnel-companies', key: 'nav.personnelCompanies' },
  { to: '/users', key: 'nav.users' },
  { to: '/settings', key: 'nav.settings' },
];

export function AppShell() {
  const { t } = useTranslation();
  const { mode, toggle } = useTheme();

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="brand">
          <img className="brand-logo" src="/logo.png" alt={t('common.appName')} />
        </span>
        <div className="header-spacer" />
        <div className="header-controls">
          <select
            className="select select--compact"
            style={{ width: 'auto' }}
            value={i18n.language}
            onChange={(e) => setLocale(e.target.value as Locale)}
            aria-label={t('settings.language')}
          >
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {l.toUpperCase()}
              </option>
            ))}
          </select>
          <button className="btn btn-sm" onClick={toggle} aria-label={t('settings.theme')}>
            {mode === 'dark' ? '☾' : '☀'}
          </button>
        </div>
      </header>

      <nav className="tab-menu">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === '/'}
            className={({ isActive }) => (isActive ? 'active' : '')}
          >
            {t(tab.key)}
          </NavLink>
        ))}
      </nav>

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
