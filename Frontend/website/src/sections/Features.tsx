import { useTranslation } from 'react-i18next';
import { Reveal } from '../components/Reveal';

const KEYS = [
  'multisite',
  'attendance',
  'payroll',
  'requests',
  'apps',
  'admin',
  'reports',
  'staffing',
  'roles',
  'i18n',
] as const;

const ICONS: Record<(typeof KEYS)[number], string> = {
  multisite: '🏗️',
  attendance: '✅',
  payroll: '💰',
  requests: '📝',
  apps: '📱',
  admin: '🛠️',
  reports: '📄',
  staffing: '🏢',
  roles: '🔐',
  i18n: '🌐',
};

export function Features() {
  const { t } = useTranslation();
  return (
    <section className="section" id="features">
      <div className="container">
        <Reveal>
          <div className="section-head">
            <h2 className="section-title">{t('features.title')}</h2>
            <p className="section-subtitle">{t('features.subtitle')}</p>
          </div>
        </Reveal>
        <div className="feature-grid">
          {KEYS.map((k) => (
            <Reveal key={k}>
              <article className="card feature-card">
                <span className="feature-icon" aria-hidden="true">
                  {ICONS[k]}
                </span>
                <h3 className="card-title">{t(`features.items.${k}.title`)}</h3>
                <p className="card-body">{t(`features.items.${k}.body`)}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
