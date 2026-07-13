/**
 * Primary navigation: a DRAWER (hamburger) navigator — the Worker app menu.
 * Items: Working Hours · Salary · New Request · My Requests · Settings.
 *
 * Header: the hamburger sits at the START; the SiteLink logo is pinned to the
 * header at the writing-direction START edge (right under RTL/Hebrew) via
 * `headerRight`, tinted from tokens. The worker sees ONLY self — there is no
 * worker picker anywhere.
 */
import React from 'react';
import { Image, View } from 'react-native';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { useTranslation } from 'react-i18next';
import type { DrawerParamList } from './types';
import { useTheme } from '../theme/ThemeProvider';
import { WorkingHoursScreen } from '../screens/WorkingHoursScreen';
import { SalaryScreen } from '../screens/SalaryScreen';
import { NewRequestScreen } from '../screens/NewRequestScreen';
import { MyRequestsScreen } from '../screens/MyRequestsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

const Drawer = createDrawerNavigator<DrawerParamList>();

// eslint-disable-next-line @typescript-eslint/no-require-imports
const LOGO = require('../../assets/logo.png');

function HeaderLogo() {
  const { theme } = useTheme();
  return (
    <View style={{ paddingHorizontal: Number(theme.tokens.spacing['3']) }}>
      <Image
        source={LOGO}
        resizeMode="contain"
        style={{ width: 96, height: 28, tintColor: theme.colors.textPrimary }}
        accessibilityLabel="SiteLink"
      />
    </View>
  );
}

export function AppDrawer() {
  const { t } = useTranslation();
  const { theme } = useTheme();

  return (
    <Drawer.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.textPrimary,
        headerTitleAlign: 'center',
        headerRight: () => <HeaderLogo />,
        drawerStyle: { backgroundColor: theme.colors.surface },
        drawerActiveTintColor: theme.colors.accent,
        drawerInactiveTintColor: theme.colors.textSecondary,
        drawerActiveBackgroundColor: theme.colors.accentSubtle,
      }}
    >
      <Drawer.Screen
        name="WorkingHours"
        component={WorkingHoursScreen}
        options={{ title: t('nav.workingHours') }}
      />
      <Drawer.Screen
        name="Salary"
        component={SalaryScreen}
        options={{ title: t('nav.salary') }}
      />
      <Drawer.Screen
        name="NewRequest"
        component={NewRequestScreen}
        options={{ title: t('nav.newRequest') }}
      />
      <Drawer.Screen
        name="MyRequests"
        component={MyRequestsScreen}
        options={{ title: t('nav.myRequests') }}
      />
      <Drawer.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: t('nav.settings') }}
      />
    </Drawer.Navigator>
  );
}
