import { useTranslation } from 'react-i18next';
import { APP_URL } from '../config';

export function Hero() {
  const { t } = useTranslation();
  return (
    <section className="hero" id="top">
      <div className="hero-bg" aria-hidden="true">
        <span className="blob blob--1" />
        <span className="blob blob--2" />
      </div>
      <div className="container hero-inner">
        <img src="/logo.png" alt="SiteLink" className="hero-logo" />
        <span className="hero-badge">{t('hero.badge')}</span>
        <h1 className="hero-title">{t('hero.title')}</h1>
        <p className="hero-subtitle">{t('hero.subtitle')}</p>
        <div className="hero-cta">
          <a href={APP_URL} className="btn btn--primary btn--lg">
            {t('hero.ctaPrimary')}
          </a>
          <a href="#contact" className="btn btn--outline btn--lg">
            {t('hero.ctaSecondary')}
          </a>
        </div>
        <ul className="hero-highlights">
          <li>{t('hero.highlight1')}</li>
          <li>{t('hero.highlight2')}</li>
          <li>{t('hero.highlight3')}</li>
        </ul>
      </div>
    </section>
  );
}
