/**
 * Primary navigation: a DRAWER (hamburger) navigator — the Foreman app menu.
 * Drawer items (in order): Dashboard · Attendance · Worker Rating · Reports · Settings.
 *
 * HEADER: the SiteLink logo sits at the header END (headerRight = the RIGHT edge in
 * LTR / the "logo-on-header-right" standard); the hamburger stays at the start.
 * Drawer tints come from tokens (active accent / accentSubtle background).
 */
import React from 'react';
import { I18nManager, Pressable, View } from 'react-native';
import {
  createDrawerNavigator,
  DrawerContentScrollView,
  DrawerItemList,
  type DrawerContentComponentProps,
} from '@react-navigation/drawer';
import { DrawerActions, useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import type { DrawerParamList } from './types';
import { useTheme } from '../theme/ThemeProvider';
import { LogoBadge } from '../components/LogoBadge';

/**
 * HamburgerButton — an EXPLICIT drawer-toggle button. We supply this as a custom
 * headerLeft/headerRight so the hamburger and logo swap TOGETHER with direction,
 * rather than relying on RN's ambiguous auto-mirror of the default toggle (which
 * did not visually move to the right under RTL). Three bars are drawn from Views
 * so no icon-font dependency is required; bar colour matches headerTintColor.
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
import { WorkersScreen } from '../features/workers/WorkersScreen';
import { AttendanceScreen } from '../features/attendance/AttendanceScreen';
import { WorkerRatingScreen } from '../features/rating/WorkerRatingScreen';
import { ReportsScreen } from '../features/reports/ReportsScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';

const Drawer = createDrawerNavigator<DrawerParamList>();

/** Custom drawer with the SiteLink logo pinned at the top. */
function DrawerContent(props: DrawerContentComponentProps) {
  const { theme } = useTheme();
  return (
    <DrawerContentScrollView {...props}>
      <View
        style={{
          alignItems: 'center',
          paddingVertical: Number(theme.tokens.spacing['4']),
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
          marginBottom: Number(theme.tokens.spacing['2']),
        }}
      >
        <LogoBadge variant="login" />
      </View>
      <DrawerItemList {...props} />
    </DrawerContentScrollView>
  );
}

export function AppDrawer() {
  const { t } = useTranslation();
  const { theme } = useTheme();

  return (
    <Drawer.Navigator
      drawerContent={(props) => <DrawerContent {...props} />}
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.textPrimary,
        // Full header mirror, deterministic (do NOT rely on RN auto-mirror):
        //   LTR (en/tr): hamburger LEFT, logo RIGHT.
        //   RTL (he):    hamburger RIGHT, logo LEFT.
        // Explicit headerLeft replaces RN's default drawer toggle → one hamburger.
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
        name="Workers"
        component={WorkersScreen}
        options={{ title: t('nav.workers') }}
      />
      <Drawer.Screen
        name="Attendance"
        component={AttendanceScreen}
        options={{ title: t('nav.attendance') }}
      />
      <Drawer.Screen
        name="WorkerRating"
        component={WorkerRatingScreen}
        options={{ title: t('nav.workerRating') }}
      />
      <Drawer.Screen
        name="Reports"
        component={ReportsScreen}
        options={{ title: t('nav.reports') }}
      />
      <Drawer.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: t('nav.settings') }}
      />
    </Drawer.Navigator>
  );
}
