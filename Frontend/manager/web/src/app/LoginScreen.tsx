/** Supabase email+password sign-in (Architecture §5.1, FR-X-AUTH). */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from './ThemeProvider';
import { useAuth } from './AuthProvider';
import { setLocale, type Locale, LOCALES } from '../i18n';
import i18n from '../i18n';

export function LoginScreen() {
  const { t } = useTranslation();
  const { signIn, supabaseConfigured, apiConfigured } = useAuth();
  const { mode, toggle } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
    } catch {
      setError(t('auth.signInError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="card auth-card">
        <div className="page-header">
          <span className="brand">
            <img className="brand-logo" src="/logo.png" alt={t('common.appName')} />
          </span>
          <div className="header-spacer" />
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

        {!apiConfigured ? (
          <div className="banner banner-warning">{t('auth.apiMissing')}</div>
        ) : null}
        {!supabaseConfigured ? (
          <div className="banner banner-warning">{t('auth.supabaseMissing')}</div>
        ) : null}

        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="email">{t('auth.email')}</label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">{t('auth.password')}</label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error ? <div className="banner banner-danger">{error}</div> : null}
          <button
            className="btn btn-primary"
            type="submit"
            disabled={busy || !supabaseConfigured}
            style={{ width: '100%' }}
          >
            {busy ? t('common.loading') : t('auth.signIn')}
          </button>
        </form>
      </div>
    </div>
  );
}
