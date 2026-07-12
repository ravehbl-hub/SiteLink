/** Root gate: routes between auth states. Signed-in → shell + feature routes. */
import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from './AuthProvider';
import { AppShell } from './AppShell';
import { LoginScreen } from './LoginScreen';
import { DashboardScreen } from '../features/dashboard/DashboardScreen';
import { WorkersRoutes } from '../features/workers/WorkersRoutes';
import { AttendanceScreen } from '../features/attendance/AttendanceScreen';
import { FinanceScreen } from '../features/finance/FinanceScreen';
import { PaymentScreen } from '../features/payment/PaymentScreen';
import { SalaryScreen } from '../features/salary/SalaryScreen';
import { SitesScreen } from '../features/sites/SitesScreen';
import { UsersScreen } from '../features/users/UsersScreen';
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
          <div className="banner banner-danger">{t('auth.forbidden')}</div>
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
          <Route path="workers/*" element={<WorkersRoutes />} />
          <Route path="attendance" element={<AttendanceScreen />} />
          <Route path="finance" element={<FinanceScreen />} />
          <Route path="payment" element={<PaymentScreen />} />
          <Route path="salary" element={<SalaryScreen />} />
          <Route path="sites" element={<SitesScreen />} />
          <Route path="users" element={<UsersScreen />} />
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
