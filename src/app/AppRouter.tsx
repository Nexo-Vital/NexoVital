import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth } from '@/features/usuarios/guards';
import { resolveRoleHome } from '@/features/usuarios/role-home';
import { useSessionStore } from '@/features/usuarios/session';
import DriverConsolePage from '@/pages/DriverConsolePage';
import LoginPage from '@/pages/LoginPage';
import SalaOperacionesPage from '@/pages/SalaOperacionesPage';
import { AppShell } from './AppShell';

/**
 * Role home. The destination comes from the single ROLE_HOME map; a role with
 * no destination never falls through to a screen that is not its own (today
 * that is CIUDADANO). RequireAuth already blocks such a role, so this redirect
 * is the last line of defence.
 */
export function RoleHome() {
  const role = useSessionStore((state) => state.role);
  switch (resolveRoleHome(role)) {
    case 'DRIVER_CONSOLE':
      return <DriverConsolePage />;
    case 'OPERATIONS':
      return <SalaOperacionesPage />;
    default:
      return <Navigate to="/login" replace />;
  }
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
