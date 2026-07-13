/**
 * Primary navigation: a DRAWER (hamburger) navigator — the Foreman app menu.
 * Drawer items (in order): Dashboard · Attendance · Worker Rating · Reports · Settings.
 *
 * HEADER: the SiteLink logo sits at the header END (headerRight = the RIGHT edge in
 * LTR / the "logo-on-header-right" standard); the hamburger stays at the start.
 * Drawer tints come from tokens (active accent / accentSubtle background).
 */
import React from 'react';
import { Image, View } from 'react-native';
import {
  createDrawerNavigator,
  DrawerContentScrollView,
  DrawerItemList,
  type DrawerContentComponentProps,
} from '@react-navigation/drawer';
import { useTranslation } from 'react-i18next';
import type { DrawerParamList } from './types';
import { useTheme } from '../theme/ThemeProvider';
import { DashboardScreen } from '../screens/DashboardScreen';
import { AttendanceScreen } from '../screens/AttendanceScreen';
import { WorkerRatingScreen } from '../screens/WorkerRatingScreen';
import { ReportsScreen } from '../screens/ReportsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const logo = require('../../assets/logo.png');

const Drawer = createDrawerNavigator<DrawerParamList>();

/** The logo shown at the header end (right in LTR). */
function HeaderLogo() {
  const { theme } = useTheme();
  return (
    <Image
      source={logo}
      resizeMode="contain"
      style={{
        width: 96,
        height: 32,
        marginEnd: Number(theme.tokens.spacing['3']),
      }}
      accessibilityLabel="SiteLink"
    />
  );
}

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
        <Image source={logo} resizeMode="contain" style={{ width: 160, height: 54 }} />
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
        headerRight: () => <HeaderLogo />,
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
