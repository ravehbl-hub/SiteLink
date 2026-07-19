import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LOCALES, setLocale, type Locale } from '../i18n';
import { APP_URL } from '../config';

const LOCALE_LABELS: Record<Locale, string> = { he: 'עב', en: 'EN', tr: 'TR' };

export function Header() {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const current = i18n.language as Locale;

  const links = [
    { href: '#features', label: t('nav.features') },
    { href: '#how', label: t('nav.how') },
    { href: '#roles', label: t('nav.roles') },
    { href: '#contact', label: t('nav.contact') },
  ];

  return (
    <header className="site-header">
      <div className="container header-inner">
        <a href="#top" className="brand" aria-label="SiteLink">
          <img src="/logo.png" alt="SiteLink" className="brand-logo" />
        </a>

        <nav className={`nav ${open ? 'nav--open' : ''}`} aria-label="Primary">
          {links.map((l) => (
            <a key={l.href} href={l.href} className="nav-link" onClick={() => setOpen(false)}>
              {l.label}
            </a>
          ))}

          <div className="lang-switch" role="group" aria-label={t('nav.language')}>
            {LOCALES.map((loc) => (
              <button
                key={loc}
                type="button"
                className={`lang-btn ${current === loc ? 'lang-btn--active' : ''}`}
                aria-pressed={current === loc}
                onClick={() => setLocale(loc)}
              >
                {LOCALE_LABELS[loc]}
              </button>
            ))}
          </div>

          <a href={APP_URL} className="btn btn--ghost nav-cta">
            {t('nav.login')}
          </a>
          <a href={APP_URL} className="btn btn--primary nav-cta">
            {t('nav.getStarted')}
          </a>
        </nav>

        <button
          type="button"
          className="hamburger"
          aria-label={t('nav.menu')}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
      </div>
    </header>
  );
}
