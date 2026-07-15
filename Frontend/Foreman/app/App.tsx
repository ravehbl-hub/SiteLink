/**
 * SiteLink Foreman App root. Providers order (outer → inner):
 *   SafeArea → QueryClient → Theme → i18n(ready) → Auth → NavigationContainer.
 * The auth gate routes signed-in Foreman (or Admin/Manager) users to the drawer,
 * everyone else to the login screen (which also renders the unconfigured /
 * role-mismatch states).
 */
import 'react-native-gesture-handler';
import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import i18n from './src/i18n';
import { ThemeProvider, useTheme } from './src/theme/ThemeProvider';
import { AuthProvider, useAuth } from './src/auth/AuthProvider';
import { ActiveSiteProvider } from './src/site/ActiveSiteProvider';
import { AppDrawer } from './src/navigation/AppDrawer';
import { LoginScreen } from './src/screens/LoginScreen';
import { Loading } from './src/components/ui';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function Gate() {
  const { status } = useAuth();
  const { theme } = useTheme();

  const navTheme = theme.isDark
    ? {
        ...DarkTheme,
        colors: {
          ...DarkTheme.colors,
          background: theme.colors.bg,
          card: theme.colors.surface,
          text: theme.colors.textPrimary,
          border: theme.colors.border,
          primary: theme.colors.accent,
          notification: theme.colors.danger,
        },
      }
    : {
        ...DefaultTheme,
        colors: {
          ...DefaultTheme.colors,
          background: theme.colors.bg,
          card: theme.colors.surface,
          text: theme.colors.textPrimary,
          border: theme.colors.border,
          primary: theme.colors.accent,
          notification: theme.colors.danger,
        },
      };

  if (status === 'loading') return <Loading />;

  return (
    <NavigationContainer theme={navTheme}>
      <StatusBar style={theme.isDark ? 'light' : 'dark'} />
      {status === 'signedIn' ? <AppDrawer /> : <LoginScreen />}
    </NavigationContainer>
  );
}

function ThemedApp() {
  const { ready } = useTheme();
  if (!ready) return <Loading />;
  return (
    <AuthProvider>
      <ActiveSiteProvider>
        <Gate />
      </ActiveSiteProvider>
    </AuthProvider>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>
          <ThemeProvider>
            <ThemedApp />
          </ThemeProvider>
        </I18nextProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
