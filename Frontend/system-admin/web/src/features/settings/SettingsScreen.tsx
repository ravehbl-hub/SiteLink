/** Settings (FR-BO-5): theme, language, profile (from /auth/me), disconnect. */
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../app/ThemeProvider';
import { useAuth } from '../../app/AuthProvider';
import { setLocale, type Locale, LOCALES } from '../../i18n';
import i18n from '../../i18n';

export function SettingsScreen() {
  const { t } = useTranslation();
  const { mode, setMode } = useTheme();
  const { user, signOut } = useAuth();

  const roleKey = user ? `roles.${user.role}` : '';
  const roleLabel = user ? t(roleKey) : '';

  return (
    <div>
      <div className="page-header">
        <h1 className="section-title" style={{ margin: 0 }}>
          {t('settings.title')}
        </h1>
      </div>

      <div className="stack" style={{ maxWidth: 560 }}>
        <div className="card">
          <h3 className="subsection-title">{t('settings.theme')}</h3>
          <div className="inline">
            <button
              className={`btn ${mode === 'light' ? 'btn-primary' : ''}`}
              onClick={() => setMode('light')}
            >
              {t('settings.light')}
            </button>
            <button
              className={`btn ${mode === 'dark' ? 'btn-primary' : ''}`}
              onClick={() => setMode('dark')}
            >
              {t('settings.dark')}
            </button>
          </div>
        </div>

        <div className="card">
          <h3 className="subsection-title">{t('settings.language')}</h3>
          <div className="inline">
            {LOCALES.map((l) => (
              <button
                key={l}
                className={`btn ${i18n.language === l ? 'btn-primary' : ''}`}
                onClick={() => setLocale(l as Locale)}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <h3 className="subsection-title">{t('settings.profile')}</h3>
          {user ? (
            <div className="stack" style={{ gap: 'var(--sl-space-2)' }}>
              <div>
                <span className="kpi-label">{t('usersActivity.fullName')}</span>
                <div>{user.fullName}</div>
              </div>
              <div>
                <span className="kpi-label">{t('auth.email')}</span>
                <div>{user.email}</div>
              </div>
              <div>
                <span className="kpi-label">{t('usersActivity.role')}</span>
                <div>{roleLabel === roleKey ? user.role : roleLabel}</div>
              </div>
            </div>
          ) : (
            <p className="muted">—</p>
          )}
        </div>

        <div className="card">
          <h3 className="subsection-title">{t('settings.about')}</h3>
          <p className="muted">{t('settings.aboutText')}</p>
        </div>

        <div className="card">
          <button className="btn btn-danger" onClick={() => void signOut()}>
            {t('settings.disconnect')}
          </button>
        </div>
      </div>
    </div>
  );
}
