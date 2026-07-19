import { useTranslation } from 'react-i18next';
import { CONTACT_EMAIL } from '../config';

export function Footer() {
  const { t } = useTranslation();
  const year = new Date().getFullYear();
  const links = [
    { href: '#features', label: t('nav.features') },
    { href: '#how', label: t('nav.how') },
    { href: '#roles', label: t('nav.roles') },
    { href: '#contact', label: t('nav.contact') },
  ];

  return (
    <footer className="site-footer">
      <div className="container footer-inner">
        <div className="footer-brand">
          <img src="/logo.png" alt="SiteLink" className="footer-logo" />
          <p className="footer-tagline">{t('footer.tagline')}</p>
        </div>
        <nav className="footer-col" aria-label={t('footer.sections')}>
          <h4 className="footer-heading">{t('footer.sections')}</h4>
          {links.map((l) => (
            <a key={l.href} href={l.href} className="footer-link">
              {l.label}
            </a>
          ))}
        </nav>
        <div className="footer-col">
          <h4 className="footer-heading">{t('footer.contact')}</h4>
          <a href={`mailto:${CONTACT_EMAIL}`} className="footer-link">
            {CONTACT_EMAIL}
          </a>
        </div>
      </div>
      <div className="container footer-bottom">
        <span>© {year} SiteLink. {t('footer.rights')}</span>
      </div>
    </footer>
  );
}
