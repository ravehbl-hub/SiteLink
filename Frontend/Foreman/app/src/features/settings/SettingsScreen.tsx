/**
 * Settings (FR-FOR-6): dark/light theme toggle, language He/En/Tr (+ RTL for
 * Hebrew with a reload prompt), user profile (from /auth/me), and disconnect
 * (logout → Supabase sign-out). Mirrors the Manager app SettingsScreen.
 */
import React from 'react';
import { Alert, Platform, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Language, Theme } from '@sitelink/shared';
import { useTheme } from '../../theme/ThemeProvider';
import { useAuth } from '../../auth/AuthProvider';
import { isRtlLanguage } from '../../i18n';
import {
  Body,
  Button,
  Card,
  Row,
  Screen,
  SectionHeading,
  Segmented,
  Title,
} from '../../components/ui';

const APP_VERSION = '0.1.0';

export function SettingsScreen() {
  const { t } = useTranslation();
  const { themeMode, setThemeMode, language, setLanguage } = useTheme();
  const { user, signOut } = useAuth();

  function onLanguage(lang: Language) {
    if (lang === language) return;
    const directionWillFlip = isRtlLanguage(lang) !== isRtlLanguage(language);
    // On WEB, react-native-web's Alert.alert does NOT render custom buttons or fire
    // their onPress — so an Alert-gated switch means the OK callback never runs and
    // the language never changes (the "Hebrew not working" bug). Web also needs no
    // restart: applyDirection flips the DOM `dir` attribute live with no reload.
    // So on web we switch immediately; the confirm-and-reload prompt is native-only.
    if (directionWillFlip && Platform.OS !== 'web') {
      // Native direction flip (LTR ↔ RTL): warn the user the app will restart, then
      // let setLanguage persist the choice and reload so RTL/LTR takes effect.
      Alert.alert(t('settings.language'), t('settings.rtlRestartNote'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.ok'), onPress: () => void setLanguage(lang) },
      ]);
      return;
    }
    // Same-direction change (en ↔ tr), or any change on web: apply immediately.
    void setLanguage(lang);
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
              <Body muted>{t('settings.fullName')}</Body>
              <Body>{user.fullName}</Body>
            </Row>
            <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
              <Body muted>{t('settings.email')}</Body>
              <Body>{user.email}</Body>
            </Row>
            <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
              <Body muted>{t('settings.role')}</Body>
              <Body>{t(`roles.${user.role}`)}</Body>
            </Row>
          </>
        ) : (
          <Body muted>—</Body>
        )}
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
