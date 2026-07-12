/** Workers stack — list → wizard / details. */
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeProvider';
import type { WorkersStackParamList } from './types';
import { WorkersListScreen } from '../screens/workers/WorkersListScreen';
import { WorkerWizardScreen } from '../screens/workers/WorkerWizardScreen';
import { WorkerDetailsScreen } from '../screens/workers/WorkerDetailsScreen';

const Stack = createNativeStackNavigator<WorkersStackParamList>();

export function WorkersStack() {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const screenOptions = {
    headerStyle: { backgroundColor: theme.colors.surface },
    headerTintColor: theme.colors.textPrimary,
    contentStyle: { backgroundColor: theme.colors.bg },
  };
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="WorkersList"
        component={WorkersListScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="WorkerWizard"
        component={WorkerWizardScreen}
        options={{ title: t('workers.add') }}
      />
      <Stack.Screen
        name="WorkerDetails"
        component={WorkerDetailsScreen}
        options={{ title: t('workers.details') }}
      />
    </Stack.Navigator>
  );
}
