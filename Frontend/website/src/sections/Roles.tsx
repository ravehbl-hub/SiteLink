import { useTranslation } from 'react-i18next';
import { Reveal } from '../components/Reveal';

const ROLES = ['manager', 'foreman', 'worker', 'admin'] as const;

export function Roles() {
  const { t } = useTranslation();
  return (
    <section className="section" id="roles">
      <div className="container">
        <Reveal>
          <div className="section-head">
            <h2 className="section-title">{t('roles.title')}</h2>
            <p className="section-subtitle">{t('roles.subtitle')}</p>
          </div>
        </Reveal>
        <div className="roles-grid">
          {ROLES.map((r) => (
            <Reveal key={r}>
              <article className="card role-card">
                <div className="role-head">
                  <h3 className="card-title">{t(`roles.items.${r}.name`)}</h3>
                  <span className="role-surface">{t(`roles.items.${r}.surface`)}</span>
                </div>
                <p className="card-body">{t(`roles.items.${r}.body`)}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
