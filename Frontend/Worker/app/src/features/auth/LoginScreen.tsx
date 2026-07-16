/**
 * Login (Architecture §5). Email+password → Supabase session → /auth/me gate.
 * Renders the "unconfigured" state clearly for local dev, and a role-mismatch
 * banner (auth.notWorker) when a verified identity is not a Worker.
 */
import React, { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthProvider';
import { ApiError } from '../../lib/api';
import { Body, Button, Card, Field, ScreenPlain, Title } from '../../components/ui';
import { LogoBadge } from '../../components/LogoBadge';
import { useTheme } from '../../theme/ThemeProvider';

export function LoginScreen() {
  const { t } = useTranslation();
  const { signIn, status } = useAuth();
  const { theme } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const unconfigured = status === 'unconfigured';

  async function onSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('auth.invalidCredentials'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScreenPlain>
      <View style={{ flex: 1, justifyContent: 'center', padding: 20 }}>
        <View style={{ alignItems: 'center', marginBottom: Number(theme.tokens.spacing['4']) }}>
          <LogoBadge variant="login" />
        </View>
        <Title>{t('common.appName')}</Title>
        {unconfigured ? (
          <Card>
            <Title>{t('auth.notConfiguredTitle')}</Title>
            <Body muted>{t('auth.notConfiguredBody')}</Body>
          </Card>
        ) : (
          <Card>
            <Body muted>{t('auth.signInSubtitle')}</Body>
            <View style={{ height: 12 }} />
            <Field
              label={t('auth.email')}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              textContentType="emailAddress"
            />
            <Field
              label={t('auth.password')}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType="password"
            />
            {error ? (
              <View
                style={{
                  backgroundColor: theme.colors.dangerSubtle,
                  padding: 10,
                  borderRadius: 6,
                  marginBottom: 12,
                }}
              >
                <Body>{error}</Body>
              </View>
            ) : null}
            {status === 'unauthorized' ? (
              <View
                style={{
                  backgroundColor: theme.colors.warningSubtle,
                  padding: 10,
                  borderRadius: 6,
                  marginBottom: 12,
                }}
              >
                <Body>{t('auth.notWorker')}</Body>
              </View>
            ) : null}
            <Button
              title={submitting ? t('auth.signingIn') : t('auth.signIn')}
              onPress={onSubmit}
              loading={submitting}
              disabled={!email || !password}
            />
          </Card>
        )}
      </View>
    </ScreenPlain>
  );
}
