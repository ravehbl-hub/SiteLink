/**
 * Settings (FR-MGR-SET): dark/light theme toggle, language He/En/Tr, user profile,
 * about, disconnect (logout → Supabase sign-out, ends the session). Language change
 * applies RTL for Hebrew and prompts a restart note when direction flips.
 *
 * Account editing: the signed-in manager can change their own FULL NAME (persisted via
 * PATCH /users/:id on their own id, then refreshMe) and their PASSWORD (Supabase-owned,
 * via auth.changePassword). The profile card also shows the read-only COMPANY NAME
 * (self-scoped, from GET /auth/me → companyName).
 */
import React, { useState } from 'react';
import { Alert, Platform, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Language, Theme } from '@sitelink/shared';
import { useTheme } from '../../theme/ThemeProvider';
import { useAuth } from '../../auth/AuthProvider';
import { isRtlLanguage } from '../../i18n';
import { endpoints } from '../../lib/endpoints';
import { ApiError } from '../../lib/api';
import {
  Body,
  Button,
  Card,
  Field,
  Row,
  Screen,
  SectionHeading,
  Segmented,
  Title,
} from '../../components/ui';

const APP_VERSION = '0.1.0';
const MIN_PASSWORD = 8;

export function SettingsScreen() {
  const { t } = useTranslation();
  const { themeMode, setThemeMode, language, setLanguage } = useTheme();
  const { user, companyName, signOut, refreshMe, changePassword } = useAuth();

  const [name, setName] = useState(user?.fullName ?? '');
  const [savingName, setSavingName] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  function onLanguage(lang: Language) {
    if (lang === language) return;
    const directionWillFlip = isRtlLanguage(lang) !== isRtlLanguage(language);
    // On WEB, react-native-web's Alert.alert does NOT fire custom-button callbacks,
    // so an Alert-gated switch would never run setLanguage. Web also needs no restart
    // (applyDirection flips the DOM `dir` live), so switch immediately there; the
    // confirm-and-reload prompt is native-only.
    if (directionWillFlip && Platform.OS !== 'web') {
      Alert.alert(t('settings.language'), t('settings.rtlRestartNote'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.ok'), onPress: () => void setLanguage(lang) },
      ]);
      return;
    }
    void setLanguage(lang);
  }

  async function onSaveName() {
    const trimmed = name.trim();
    if (!user || trimmed.length === 0 || trimmed === user.fullName) return;
    setSavingName(true);
    try {
      await endpoints.updateUser(user.id, { fullName: trimmed });
      await refreshMe();
      Alert.alert(t('settings.changeName'), t('settings.nameUpdated'));
    } catch (e) {
      Alert.alert(t('common.error'), e instanceof ApiError ? e.message : String(e));
    } finally {
      setSavingName(false);
    }
  }

  async function onSavePassword() {
    if (newPassword.length < MIN_PASSWORD) {
      Alert.alert(t('common.error'), t('settings.passwordTooShort'));
      return;
    }
    if (newPassword !== confirm) {
      Alert.alert(t('common.error'), t('settings.passwordMismatch'));
      return;
    }
    setSavingPassword(true);
    try {
      await changePassword(newPassword);
      setNewPassword('');
      setConfirm('');
      Alert.alert(t('settings.changePassword'), t('settings.passwordUpdated'));
    } catch (e) {
      Alert.alert(t('common.error'), e instanceof ApiError ? e.message : String(e));
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <Screen>
      <Title>{t('settings.title')}</Title>

      <Card>
        <SectionHeading>{t('settings.theme')}</SectionHeading>
        <Segmented
          options={[
            { value: Theme.LIGHT, label: t('settings.light') },
            { value: Theme.DARK, label: t('settings.dark') },
          ]}
          value={themeMode}
          onChange={setThemeMode}
        />
      </Card>

      <Card>
        <SectionHeading>{t('settings.language')}</SectionHeading>
        <Segmented
          options={[
            { value: Language.HE, label: t('settings.languageHe') },
            { value: Language.EN, label: t('settings.languageEn') },
            { value: Language.TR, label: t('settings.languageTr') },
          ]}
          value={language}
          onChange={onLanguage}
        />
      </Card>

      <Card>
        <SectionHeading>{t('settings.profile')}</SectionHeading>
        {user ? (
          <>
            <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
              <Body muted>{t('users.fullName')}</Body>
              <Body>{user.fullName}</Body>
            </Row>
            <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
              <Body muted>{t('users.email')}</Body>
              <Body>{user.email}</Body>
            </Row>
            <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
              <Body muted>{t('users.role')}</Body>
              <Body>{t(`roles.${user.role}`)}</Body>
            </Row>
            <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
              <Body muted>{t('users.company')}</Body>
              <Body>{companyName ?? '—'}</Body>
            </Row>
          </>
        ) : (
          <Body muted>—</Body>
        )}
      </Card>

      <Card>
        <SectionHeading>{t('settings.changeName')}</SectionHeading>
        <Field
          label={t('settings.fullNameLabel')}
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
        />
        <Button
          title={t('settings.saveName')}
          onPress={() => void onSaveName()}
          loading={savingName}
          disabled={
            savingName || name.trim().length === 0 || name.trim() === user?.fullName
          }
        />
      </Card>

      <Card>
        <SectionHeading>{t('settings.changePassword')}</SectionHeading>
        <Field
          label={t('settings.newPassword')}
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
          autoCapitalize="none"
        />
        <Field
          label={t('settings.confirmPassword')}
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
          autoCapitalize="none"
        />
        <Button
          title={t('settings.savePassword')}
          onPress={() => void onSavePassword()}
          loading={savingPassword}
          disabled={savingPassword || newPassword.length === 0 || confirm.length === 0}
        />
      </Card>

      <Card>
        <SectionHeading>{t('settings.about')}</SectionHeading>
        <Body muted>{t('settings.aboutBody', { version: APP_VERSION })}</Body>
      </Card>

      <View style={{ height: 8 }} />
      <Button
        title={t('settings.disconnect')}
        variant="danger"
        onPress={() =>
          Alert.alert(t('settings.disconnectConfirm'), '', [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('settings.disconnect'), style: 'destructive', onPress: () => void signOut() },
          ])
        }
      />
    </Screen>
  );
}
