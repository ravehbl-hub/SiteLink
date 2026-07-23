/** Settings (FR-MGR-SET): theme, language, profile (+ company), account (change
 *  email / password), about, disconnect. */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../app/ThemeProvider';
import { useAuth } from '../../app/AuthProvider';
import { setLocale, type Locale, LOCALES } from '../../i18n';
import i18n from '../../i18n';
import { Modal, Field } from '../../components/ui';

const MIN_PASSWORD_LENGTH = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SettingsScreen() {
  const { t } = useTranslation();
  const { mode, setMode } = useTheme();
  const { user, companyName, signOut } = useAuth();
  const [emailOpen, setEmailOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);

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
                <span className="kpi-label">{t('users.fullName')}</span>
                <div>{user.fullName}</div>
              </div>
              <div>
                <span className="kpi-label">{t('auth.email')}</span>
                <div>{user.email}</div>
              </div>
              <div>
                <span className="kpi-label">{t('settings.company')}</span>
                <div>{companyName ?? '—'}</div>
              </div>
              <div>
                <span className="kpi-label">{t('users.role')}</span>
                <div>{t(`roles.${user.role}`)}</div>
              </div>
            </div>
          ) : (
            <p className="muted">—</p>
          )}
        </div>

        <div className="card">
          <h3 className="subsection-title">{t('settings.account')}</h3>
          <div className="inline">
            <button className="btn" onClick={() => setEmailOpen(true)} disabled={!user}>
              {t('settings.changeEmail')}
            </button>
            <button className="btn" onClick={() => setPwOpen(true)} disabled={!user}>
              {t('settings.changePassword')}
            </button>
          </div>
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

      {emailOpen ? <ChangeEmailForm onClose={() => setEmailOpen(false)} /> : null}
      {pwOpen ? <ChangePasswordForm onClose={() => setPwOpen(false)} /> : null}
    </div>
  );
}

/** Change the signed-in user's email (Supabase login + app display email). */
function ChangeEmailForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { user, changeEmail } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const invalid = email.length > 0 && !EMAIL_RE.test(email.trim());
  const canSubmit = EMAIL_RE.test(email.trim()) && email.trim() !== user?.email;

  const mut = useMutation({
    mutationFn: () => changeEmail(email.trim()),
    onSuccess: () => {
      setError(null);
      setDone(true);
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  return (
    <Modal
      title={t('settings.changeEmail')}
      onClose={onClose}
      footer={
        done ? (
          <button className="btn btn-primary" onClick={onClose}>
            {t('common.close')}
          </button>
        ) : (
          <>
            <button className="btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button
              className="btn btn-primary"
              disabled={!canSubmit || mut.isPending}
              onClick={() => mut.mutate()}
            >
              {t('common.save')}
            </button>
          </>
        )
      }
    >
      {done ? (
        <div className="banner banner-info">{t('settings.emailChangeSent')}</div>
      ) : (
        <>
          {error ? <div className="banner banner-danger">{error}</div> : null}
          <Field label={t('settings.newEmail')}>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {invalid ? <span className="muted">{t('workers.emailInvalid')}</span> : null}
          </Field>
        </>
      )}
    </Modal>
  );
}

/** Change the signed-in user's password: current + new + repeat (min 8, must match). */
function ChangePasswordForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { changePassword } = useAuth();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const tooShort = newPassword.length > 0 && newPassword.length < MIN_PASSWORD_LENGTH;
  const mismatch = repeat.length > 0 && newPassword !== repeat;
  const canSubmit =
    oldPassword.length > 0 &&
    newPassword.length >= MIN_PASSWORD_LENGTH &&
    newPassword === repeat;

  const mut = useMutation({
    mutationFn: () => changePassword(oldPassword, newPassword),
    onSuccess: () => {
      setError(null);
      setDone(true);
    },
    onError: (e) =>
      setError(
        e instanceof Error && e.message === 'old-password-invalid'
          ? t('settings.oldPasswordWrong')
          : e instanceof Error
            ? e.message
            : String(e),
      ),
  });

  return (
    <Modal
      title={t('settings.changePassword')}
      onClose={onClose}
      footer={
        done ? (
          <button className="btn btn-primary" onClick={onClose}>
            {t('common.close')}
          </button>
        ) : (
          <>
            <button className="btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button
              className="btn btn-primary"
              disabled={!canSubmit || mut.isPending}
              onClick={() => mut.mutate()}
            >
              {t('common.save')}
            </button>
          </>
        )
      }
    >
      {done ? (
        <div className="banner banner-info">{t('settings.passwordChanged')}</div>
      ) : (
        <>
          {error ? <div className="banner banner-danger">{error}</div> : null}
          <Field label={t('settings.oldPassword')}>
            <input
              className="input"
              type="password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
            />
          </Field>
          <Field label={t('settings.newPassword')}>
            <input
              className="input"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            {tooShort ? <span className="muted">{t('settings.passwordTooShort')}</span> : null}
          </Field>
          <Field label={t('settings.repeatPassword')}>
            <input
              className="input"
              type="password"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
            />
            {mismatch ? <span className="muted">{t('settings.passwordMismatch')}</span> : null}
          </Field>
        </>
      )}
    </Modal>
  );
}
