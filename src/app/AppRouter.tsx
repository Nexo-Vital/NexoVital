import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth } from '@/features/usuarios/guards';
import { useSessionStore } from '@/features/usuarios/session';
import DriverConsolePage from '@/pages/DriverConsolePage';
import LoginPage from '@/pages/LoginPage';
import SalaOperacionesPage from '@/pages/SalaOperacionesPage';
import { AppShell } from './AppShell';

/**
 * Role home. Only coordinators land on the CRUE operations room; drivers get
 * the (still pending) driver console.
 */
function RoleHome() {
  const role = useSessionStore((state) => state.role);
  if (role === 'CONDUCTOR') {
    return <DriverConsolePage />;
  }
  return <SalaOperacionesPage />;
}

/** Route table for this unit: login + the CRUE screen. */
export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<RoleHome />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
