import { useTranslation } from 'react-i18next';
import { Reveal } from '../components/Reveal';

const STEPS = ['s1', 's2', 's3', 's4', 's5'] as const;

export function HowItWorks() {
  const { t } = useTranslation();
  return (
    <section className="section section--muted" id="how">
      <div className="container">
        <Reveal>
          <div className="section-head">
            <h2 className="section-title">{t('how.title')}</h2>
            <p className="section-subtitle">{t('how.subtitle')}</p>
          </div>
        </Reveal>
        <ol className="steps">
          {STEPS.map((s, i) => (
            <Reveal key={s}>
              <li className="step">
                <span className="step-num" aria-hidden="true">
                  {i + 1}
                </span>
                <div>
                  <h3 className="step-title">{t(`how.steps.${s}.title`)}</h3>
                  <p className="step-body">{t(`how.steps.${s}.body`)}</p>
                </div>
              </li>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
