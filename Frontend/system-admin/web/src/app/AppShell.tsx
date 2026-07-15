/**
 * Authenticated shell: brand header (logo on the header START/RIGHT) + a VERTICAL
 * navigation rail. The rail is on the inline-START side (LEFT for en/tr, RIGHT for
 * he) via a dir-driven CSS grid + logical properties — never physical left/right
 * (FR-X-I18N-6). The active item shows an accent text + accentSubtle background and
 * a border-inline-start accent bar.
 */
import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTheme } from './ThemeProvider';
import { setLocale, type Locale, LOCALES } from '../i18n';
import i18n from '../i18n';

interface NavItem {
  to: string;
  key: string;
  future?: boolean;
}

const NAV: NavItem[] = [
  { to: '/', key: 'nav.dashboard' },
  { to: '/users-activity', key: 'nav.usersActivity' },
  { to: '/bookkeeping', key: 'nav.bookkeeping' },
  { to: '/customers', key: 'nav.customers', future: true },
  { to: '/billing', key: 'nav.billing', future: true },
  { to: '/usage', key: 'nav.usage', future: true },
  { to: '/settings', key: 'nav.settings' },
];

export function AppShell() {
  const { t } = useTranslation();
  const { mode, toggle } = useTheme();

  return (
    <div className="app-shell">
      <header className="app-header">
        {/* Logo on the header START (RIGHT for he / LEFT for en+tr) — logical order. */}
        <span className="brand">
          <img className="brand-logo" src="/logo.png" alt={t('common.appName')} />
        </span>
        <div className="header-spacer" />
        <div className="header-controls">
          <select
            className="select"
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

      <div className="app-body">
        <nav className="side-nav" aria-label={t('common.appName')}>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
            >
              <span className="nav-label">{t(item.key)}</span>
              {item.future ? (
                <span className="nav-future">{t('common.futureLabel')}</span>
              ) : null}
            </NavLink>
          ))}
        </nav>

        <main className="app-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
