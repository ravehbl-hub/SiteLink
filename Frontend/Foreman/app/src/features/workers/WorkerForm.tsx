/**
 * WorkerForm — the shared ADD / EDIT form for a Foreman-owned worker.
 *
 * FIELD ORDER (ADD, per FR): email → FIRST PASSWORD → firstName → lastName →
 * profession → level → phone → (personnelCompany, residence). role is IMPLICITLY
 * WORKER (never shown as editable). Site is the foreman's ACTIVE site (shown, not a
 * free choice); when the foreman has >1 site a Select limited to their union is shown.
 *
 * PASSWORD: required on ADD only (min 8), with a show/hide toggle and an inline
 * 'min 8' validation hint. On EDIT the password field is OMITTED (never resent).
 *
 * Colors/space/radius come from tokens (via the shared ui primitives); directional
 * text uses textAlign:'auto' so he renders RTL. Server errors (400/403/409) are
 * surfaced as a friendly inline banner by the calling screen.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Profession, WorkerLevel } from '@sitelink/shared';
import type { CreateWorkerInput, WorkerWithDetails } from '@sitelink/shared';
import { useTheme } from '../../theme/ThemeProvider';
import { useActiveSite } from '../../site/ActiveSiteProvider';
import { Body, Button, SectionHeading, Segmented } from '../../components/ui';

/** The wire payload the form emits. On EDIT `password` is always absent. */
export interface WorkerFormValues extends CreateWorkerInput {}

const PASSWORD_MIN = 8;

/**
 * A labeled text field with an optional inline error and (for the password) a
 * trailing show/hide toggle. Built inline (not the shared Field) so the password
 * row can host the toggle without altering the shared primitive.
 */
function LabeledInput({
  label,
  required,
  error,
  trailing,
  ...props
}: React.ComponentProps<typeof TextInput> & {
  label: string;
  required?: boolean;
  error?: string | null;
  trailing?: React.ReactNode;
}) {
  const { theme } = useTheme();
  return (
    <View style={{ marginBottom: Number(theme.tokens.spacing['3']) }}>
      <Text
        style={{
          color: theme.colors.textSecondary,
          marginBottom: Number(theme.tokens.spacing['1']),
          fontSize: Number(theme.tokens.fontSize.sm ?? 14),
          textAlign: 'auto',
        }}
      >
        {label}
        {required ? ' *' : ''}
      </Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          borderColor: error ? theme.colors.danger : theme.colors.border,
          borderWidth: 1,
          borderRadius: Number(theme.tokens.radii.sm),
          backgroundColor: theme.colors.surface,
          paddingEnd: trailing ? Number(theme.tokens.spacing['2']) : 0,
        }}
      >
        <TextInput
          placeholderTextColor={theme.colors.textMuted}
          {...props}
          style={{
            flex: 1,
            paddingVertical: Number(theme.tokens.spacing['2']),
            paddingHorizontal: Number(theme.tokens.spacing['3']),
            color: theme.colors.textPrimary,
            textAlign: 'auto',
          }}
        />
        {trailing}
      </View>
      {error ? (
        <Text
          style={{
            color: theme.colors.danger,
            fontSize: Number(theme.tokens.fontSize.xs ?? 12),
            marginTop: Number(theme.tokens.spacing['1']),
            textAlign: 'auto',
          }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function WorkerForm({
  mode,
  initial,
  submitting,
  onSubmit,
}: {
  mode: 'add' | 'edit';
  initial?: WorkerWithDetails | null;
  submitting?: boolean;
  onSubmit: (values: WorkerFormValues) => void;
}) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { sites, activeSiteId } = useActiveSite();

  const [email, setEmail] = useState(initial?.email ?? '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [firstName, setFirstName] = useState(initial?.firstName ?? '');
  const [lastName, setLastName] = useState(initial?.lastName ?? '');
  const [profession, setProfession] = useState<Profession>(initial?.profession ?? Profession.GENERAL_LABORER);
  const [level, setLevel] = useState<WorkerLevel>(initial?.level ?? WorkerLevel.MEDIUM);
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [residence, setResidence] = useState(initial?.residence ?? '');
  // NOTE: personnelCompany intentionally OMITTED from the foreman form. Cortex asked
  // for a data-driven personnel-company picker, but GET /personnel-companies is gated
  // MANAGER_ROLES=[ADMIN,MANAGER] server-side — a FOREMAN token gets 403, so the list
  // cannot be populated. Blocker flagged to Cortex; field left out until the backend
  // allows FOREMAN read. (Also: the shared Worker DTO has `personnelCompany: string`,
  // not a `personnelCompanyId` FK, so the picker contract would need alignment too.)

  // Site selection: single site → fixed to active; multi-site → picker limited to
  // the foreman's own union. On EDIT default to the worker's first current site if
  // it is within the union, else the active site.
  const initialSiteId = useMemo(() => {
    const current = initial?.siteIds?.find((id) => sites.some((s) => s.siteId === id));
    return current ?? activeSiteId ?? sites[0]?.siteId ?? null;
  }, [initial, sites, activeSiteId]);
  const [siteId, setSiteId] = useState<string | null>(initialSiteId);

  const [touched, setTouched] = useState(false);

  const emailError =
    touched && !email.trim()
      ? t('workers.emailRequired')
      : touched && email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
        ? t('workers.emailInvalid')
        : null;
  const passwordError =
    mode === 'add' && touched && password.length < PASSWORD_MIN ? t('workers.passwordMin') : null;
  const firstNameError = touched && !firstName.trim() ? t('workers.required') : null;
  const lastNameError = touched && !lastName.trim() ? t('workers.required') : null;
  const siteError = touched && !siteId ? t('workers.siteRequired') : null;

  const professionOptions = Object.values(Profession).map((p) => ({
    value: p,
    label: t(`professions.${p}`),
  }));
  const levelOptions = Object.values(WorkerLevel).map((l) => ({
    value: l,
    label: t(`levels.${l}`),
  }));

  function handleSubmit() {
    setTouched(true);
    const emailOk = email.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    const passwordOk = mode === 'edit' || password.length >= PASSWORD_MIN;
    if (!emailOk || !passwordOk || !firstName.trim() || !lastName.trim() || !siteId) return;

    const values: WorkerFormValues = {
      email: email.trim(),
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      profession,
      level,
      phone: phone.trim() ? phone.trim() : null,
      residence: residence.trim() ? residence.trim() : null,
      siteIds: [siteId],
    };
    // Password is sent ONLY on ADD; never resent on EDIT.
    if (mode === 'add') values.password = password;
    onSubmit(values);
  }

  const multiSite = sites.length > 1;
  const activeSiteName = sites.find((s) => s.siteId === siteId)?.name ?? '—';

  return (
    <View>
      {/* 1) email (required) */}
      <LabeledInput
        label={t('workers.email')}
        required
        error={emailError}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        autoCorrect={false}
        placeholder="name@example.com"
        editable={mode === 'add'}
      />

      {/* 2) FIRST PASSWORD (required on ADD only, min 8, show/hide) */}
      {mode === 'add' ? (
        <LabeledInput
          label={t('workers.password')}
          required
          error={passwordError}
          value={password}
          onChangeText={setPassword}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry={!showPassword}
          placeholder={t('workers.passwordMin')}
          trailing={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={showPassword ? t('workers.passwordHide') : t('workers.passwordShow')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={() => setShowPassword((v) => !v)}
              style={{ paddingHorizontal: Number(theme.tokens.spacing['1']) }}
            >
              <Text style={{ color: theme.colors.accent, fontWeight: '600' }}>
                {showPassword ? t('workers.passwordHide') : t('workers.passwordShow')}
              </Text>
            </Pressable>
          }
        />
      ) : null}

      {/* 3) rest */}
      <LabeledInput
        label={t('workers.firstName')}
        required
        error={firstNameError}
        value={firstName}
        onChangeText={setFirstName}
      />
      <LabeledInput
        label={t('workers.lastName')}
        required
        error={lastNameError}
        value={lastName}
        onChangeText={setLastName}
      />

      <SectionHeading>{t('workers.profession')}</SectionHeading>
      <Segmented options={professionOptions} value={profession} onChange={setProfession} />

      <SectionHeading>{t('workers.level')}</SectionHeading>
      <Segmented options={levelOptions} value={level} onChange={setLevel} />

      <View style={{ height: Number(theme.tokens.spacing['2']) }} />
      <LabeledInput
        label={t('workers.phone')}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
      />
      <LabeledInput label={t('workers.residence')} value={residence} onChangeText={setResidence} />

      {/* Site — the foreman's active/assigned site. role is implicitly WORKER (hidden). */}
      <SectionHeading>{t('workers.site')}</SectionHeading>
      {multiSite ? (
        <>
          <Segmented
            options={sites.map((s) => ({ value: s.siteId, label: s.name }))}
            value={siteId}
            onChange={setSiteId}
          />
          {siteError ? (
            <Text style={{ color: theme.colors.danger, textAlign: 'auto' }}>{siteError}</Text>
          ) : null}
        </>
      ) : (
        <Body muted>{activeSiteName}</Body>
      )}

      <View style={{ height: Number(theme.tokens.spacing['3']) }} />
      <Button
        title={mode === 'add' ? t('workers.create') : t('common.save')}
        onPress={handleSubmit}
        loading={submitting}
      />
    </View>
  );
}
