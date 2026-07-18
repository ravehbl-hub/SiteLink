/**
 * Primary navigation: a DRAWER (hamburger) navigator — the Manager app menu
 * (Architecture §2: Manager app = hamburger). Each domain is a drawer item.
 */
import React from 'react';
import { I18nManager } from 'react-native';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { useTranslation } from 'react-i18next';
import type { DrawerParamList } from './types';
import { useTheme } from '../theme/ThemeProvider';
import { LogoBadge } from '../components/LogoBadge';
import { DashboardScreen } from '../features/dashboard/DashboardScreen';
import { RequestsScreen } from '../features/requests/RequestsScreen';
import { AttendanceScreen } from '../features/attendance/AttendanceScreen';
import { FinanceScreen } from '../features/finance/FinanceScreen';
import { PaymentScreen } from '../features/payment/PaymentScreen';
import { SalaryScreen } from '../features/salary/SalaryScreen';
import { SitesScreen } from '../features/sites/SitesScreen';
import { UsersScreen } from '../features/users/UsersScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { WorkersStack } from './WorkersStack';

const Drawer = createDrawerNavigator<DrawerParamList>();

export function AppDrawer() {
  const { t } = useTranslation();
  const { theme } = useTheme();

  return (
    <Drawer.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.textPrimary,
        // Logo sits at the header END, opposite the hamburger (which the drawer
        // injects at the START — headerLeft in LTR, headerRight in RTL). So the
        // logo takes the free slot: right in en/tr, left in he.
        ...(I18nManager.isRTL
          ? { headerLeft: () => <LogoBadge variant="header" /> }
          : { headerRight: () => <LogoBadge variant="header" /> }),
        drawerStyle: { backgroundColor: theme.colors.surface },
        drawerActiveTintColor: theme.colors.accent,
        drawerInactiveTintColor: theme.colors.textSecondary,
        drawerActiveBackgroundColor: theme.colors.accentSubtle,
      }}
    >
      <Drawer.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{ title: t('nav.dashboard') }}
      />
      <Drawer.Screen
        name="Requests"
        component={RequestsScreen}
        options={{ title: t('nav.requests') }}
      />
      <Drawer.Screen
        name="Workers"
        component={WorkersStack}
        options={{ title: t('nav.workers') }}
      />
      <Drawer.Screen
        name="Attendance"
        component={AttendanceScreen}
        options={{ title: t('nav.attendance') }}
      />
      <Drawer.Screen
        name="Finance"
        component={FinanceScreen}
        options={{ title: t('nav.finance') }}
      />
      <Drawer.Screen
        name="Payment"
        component={PaymentScreen}
        options={{ title: t('nav.payment') }}
      />
      <Drawer.Screen
        name="Salary"
        component={SalaryScreen}
        options={{ title: t('nav.salary') }}
      />
      <Drawer.Screen name="Sites" component={SitesScreen} options={{ title: t('nav.sites') }} />
      <Drawer.Screen name="Users" component={UsersScreen} options={{ title: t('nav.users') }} />
      <Drawer.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: t('nav.settings') }}
      />
    </Drawer.Navigator>
  );
}
