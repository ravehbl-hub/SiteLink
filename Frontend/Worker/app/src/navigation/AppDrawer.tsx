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
import { createDrawerNavigator } from '@react-navigation/drawer';
import { useTranslation } from 'react-i18next';
import type { DrawerParamList } from './types';
import { useTheme } from '../theme/ThemeProvider';
import { LogoBadge } from '../components/LogoBadge';
import { WorkingHoursScreen } from '../features/hours/WorkingHoursScreen';
import { SalaryScreen } from '../features/salary/SalaryScreen';
import { NewRequestScreen } from '../features/requests/NewRequestScreen';
import { MyRequestsScreen } from '../features/requests/MyRequestsScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';

const Drawer = createDrawerNavigator<DrawerParamList>();

export function AppDrawer() {
  const { t } = useTranslation();
  const { theme } = useTheme();

  return (
    <Drawer.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.textPrimary,
        headerTitleAlign: 'center',
        headerRight: () => <LogoBadge variant="header" />,
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
