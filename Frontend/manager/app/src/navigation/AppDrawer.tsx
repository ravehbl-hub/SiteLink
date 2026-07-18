/**
 * Primary navigation: a DRAWER (hamburger) navigator — the Manager app menu
 * (Architecture §2: Manager app = hamburger). Each domain is a drawer item.
 */
import React from 'react';
import { I18nManager, Pressable, View } from 'react-native';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { DrawerActions, useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import type { DrawerParamList } from './types';
import { useTheme } from '../theme/ThemeProvider';
import { LogoBadge } from '../components/LogoBadge';

/**
 * HamburgerButton — an EXPLICIT drawer-toggle button. We supply this as a custom
 * headerLeft/headerRight so the hamburger and logo swap TOGETHER with direction
 * (see AppDrawer header config), rather than relying on RN's ambiguous auto-mirror
 * of the default toggle (which did not visually move to the right under RTL).
 * Three bars are drawn from Views so no icon-font dependency is required; the bar
 * colour matches headerTintColor (theme.colors.textPrimary).
 */
function HamburgerButton() {
  const navigation = useNavigation();
  const { theme } = useTheme();
  const bar = {
    width: 22,
    height: 2,
    borderRadius: 1,
    backgroundColor: theme.colors.textPrimary,
    marginVertical: 2,
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open navigation menu"
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      onPress={() => navigation.dispatch(DrawerActions.toggleDrawer())}
      style={{ paddingHorizontal: 16, justifyContent: 'center' }}
    >
      <View style={bar} />
      <View style={bar} />
      <View style={bar} />
    </Pressable>
  );
}
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
        // Full header mirror, deterministic (do NOT rely on RN auto-mirror):
        //   LTR (en/tr): hamburger LEFT, logo RIGHT.
        //   RTL (he):    hamburger RIGHT, logo LEFT.
        // Supplying an explicit headerLeft also replaces RN's default drawer
        // toggle, so there is exactly one hamburger. The drawer PANEL edge is
        // still mirrored automatically by RN from isRTL (drawerPosition default).
        headerLeft: () =>
          I18nManager.isRTL ? <LogoBadge variant="header" /> : <HamburgerButton />,
        headerRight: () =>
          I18nManager.isRTL ? <HamburgerButton /> : <LogoBadge variant="header" />,
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
