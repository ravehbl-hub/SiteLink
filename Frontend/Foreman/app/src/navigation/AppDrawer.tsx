/**
 * Primary navigation: a DRAWER (hamburger) navigator — the Foreman app menu.
 * Drawer items (in order): Dashboard · Attendance · Worker Rating · Reports · Settings.
 *
 * HEADER: the SiteLink logo sits at the header END (headerRight = the RIGHT edge in
 * LTR / the "logo-on-header-right" standard); the hamburger stays at the start.
 * Drawer tints come from tokens (active accent / accentSubtle background).
 */
import React from 'react';
import { View } from 'react-native';
import {
  createDrawerNavigator,
  DrawerContentScrollView,
  DrawerItemList,
  type DrawerContentComponentProps,
} from '@react-navigation/drawer';
import { useTranslation } from 'react-i18next';
import type { DrawerParamList } from './types';
import { useTheme } from '../theme/ThemeProvider';
import { LogoBadge } from '../components/LogoBadge';
import { DashboardScreen } from '../features/dashboard/DashboardScreen';
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
        headerRight: () => <LogoBadge variant="header" />,
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
