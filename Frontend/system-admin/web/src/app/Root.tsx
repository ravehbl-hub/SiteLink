/** Root gate: routes between auth states. Signed-in ADMIN → shell + feature routes. */
import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from './AuthProvider';
import { AppShell } from './AppShell';
import { LoginScreen } from './LoginScreen';
import { DashboardScreen } from '../features/dashboard/DashboardScreen';
import { AdminUsersScreen } from '../features/adminUsers/AdminUsersScreen';
import { UsersActivityScreen } from '../features/usersActivity/UsersActivityScreen';
import { BookkeepingScreen } from '../features/bookkeeping/BookkeepingScreen';
import { CustomersScreen } from '../features/future/CustomersScreen';
import { BillingScreen } from '../features/future/BillingScreen';
import { UsageScreen } from '../features/future/UsageScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';

export function Root() {
  const { status } = useAuth();
  const { t } = useTranslation();

  if (status === 'loading') {
    return <div className="loading-state">{t('auth.checking')}</div>;
  }

  if (status === 'forbidden') {
    return (
      <div className="auth-screen">
        <div className="card auth-card">
          <div className="banner banner-danger">{t('auth.notAdmin')}</div>
          <SignOutButton />
        </div>
      </div>
    );
  }

  if (status !== 'signed-in') {
    return <LoginScreen />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<DashboardScreen />} />
          <Route path="admin-users" element={<AdminUsersScreen />} />
          <Route path="users-activity" element={<UsersActivityScreen />} />
          <Route path="bookkeeping" element={<BookkeepingScreen />} />
          <Route path="customers" element={<CustomersScreen />} />
          <Route path="billing" element={<BillingScreen />} />
          <Route path="usage" element={<UsageScreen />} />
          <Route path="settings" element={<SettingsScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

function SignOutButton() {
  const { signOut } = useAuth();
  const { t } = useTranslation();
  return (
    <button className="btn" onClick={() => void signOut()}>
      {t('auth.signOut')}
    </button>
  );
}
