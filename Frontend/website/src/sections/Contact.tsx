import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Reveal } from '../components/Reveal';
import { CONTACT_EMAIL } from '../config';

export function Contact() {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');

  // Non-functional / static marketing: no backend. Submitting composes a
  // mailto: so it opens the visitor's own email client.
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const subject = encodeURIComponent(`SiteLink demo request — ${name || 'website'}`);
    const body = encodeURIComponent(`${message}\n\n${name}\n${email}`);
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;
  }

  return (
    <section className="section section--cta" id="contact">
      <div className="container">
        <Reveal>
          <div className="cta-card card">
            <div className="section-head">
              <h2 className="section-title">{t('contact.title')}</h2>
              <p className="section-subtitle">{t('contact.subtitle')}</p>
            </div>
            <form className="contact-form" onSubmit={onSubmit}>
              <label className="field">
                <span className="field-label">{t('contact.name')}</span>
                <input
                  className="input"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </label>
              <label className="field">
                <span className="field-label">{t('contact.email')}</span>
                <input
                  className="input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>
              <label className="field field--full">
                <span className="field-label">{t('contact.message')}</span>
                <textarea
                  className="input"
                  rows={4}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </label>
              <div className="field--full">
                <button type="submit" className="btn btn--primary btn--lg">
                  {t('contact.send')}
                </button>
              </div>
            </form>
            <p className="contact-note">
              {t('contact.note')} {t('contact.or')}{' '}
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
