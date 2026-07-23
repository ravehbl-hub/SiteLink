/**
 * Primary navigation: a DRAWER (hamburger) navigator — the Worker app menu.
 * Items: Working Hours · New Request · My Requests · Settings.
 *
 * Header: the hamburger sits at the START; the SiteLink logo is pinned to the
 * header at the writing-direction START edge (right under RTL/Hebrew) via
 * `headerRight`, tinted from tokens. The worker sees ONLY self — there is no
 * worker picker anywhere.
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
import { WorkingHoursScreen } from '../features/hours/WorkingHoursScreen';
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
        name="WorkingHours"
        component={WorkingHoursScreen}
        options={{ title: t('nav.workingHours') }}
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
