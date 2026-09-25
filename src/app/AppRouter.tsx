import { Ambulance, ClipboardList, HandHeart, Map as MapIcon } from 'lucide-react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useDriverAlertsStore } from '@/features/conductor/driver-alerts-store';
import { resolveDriverAmbulanceId } from '@/features/conductor/driver-session';
import { RequireAuth } from '@/features/usuarios/guards';
import { resolveRoleHome } from '@/features/usuarios/role-home';
import { useSessionStore } from '@/features/usuarios/session';
import CitizenMapPage from '@/pages/CitizenMapPage';
import DriverConsolePage from '@/pages/DriverConsolePage';
import LoginPage from '@/pages/LoginPage';
import { AppFrame, type AppFrameNavItem } from './AppFrame';

/**
 * Sidebar navigation for the citizen shell. "Mis solicitudes" and "Mis
 * donaciones" have no screen yet, so their entries are deliberately inert
 * (rendered, never clickable) rather than dead links.
 */
export const CITIZEN_NAV: AppFrameNavItem[] = [
  { key: 'map', label: 'Mapa', icon: MapIcon },
  { key: 'requests', label: 'Mis solicitudes', icon: Ambulance },
  { key: 'donations', label: 'Mis donaciones', icon: HandHeart },
];

/**
 * Sidebar navigation for the driver shell. "Solicitudes" and "Mi unidad" have
 * no screen yet, so their entries are deliberately inert (rendered, never
 * clickable), exactly like the citizen shell.
 */
export const DRIVER_NAV: AppFrameNavItem[] = [
  { key: 'map', label: 'Mapa', icon: MapIcon },
  { key: 'requests', label: 'Solicitudes', icon: ClipboardList },
  { key: 'unit', label: 'Mi unidad', icon: Ambulance },
];

/**
 * Picks the chrome for the signed-in role. The citizen and the driver get the
 * v2 AppFrame; a role with no home renders no chrome at all and is sent back to
 * the login screen. The driver's topbar carries its unit id as the role suffix.
 */
function RoleChrome() {
  const role = useSessionStore((state) => state.role);
  const userId = useSessionStore((state) => state.user?.id);
  // Only the driver console ever writes it, so every other role reads zero and
  // its bell keeps rendering without a badge.
  const pendingRequests = useDriverAlertsStore((state) => state.pendingRequests);
  const home = resolveRoleHome(role);
  if (home === 'CITIZEN_MAP') {
    return <AppFrame nav={CITIZEN_NAV} activeKey="map" />;
  }
  if (home === 'DRIVER_CONSOLE') {
    return (
      <AppFrame
        nav={DRIVER_NAV}
        activeKey="map"
        roleDetail={resolveDriverAmbulanceId(userId)}
        bellCount={pendingRequests}
      />
    );
  }
  // A role with no home must never get a chrome: redirect to login instead of
  // rendering a shell around a screen that is not its own.
  return <Navigate to="/login" replace />;
}

/**
 * Role home. The destination comes from the single ROLE_HOME map; a role with
 * no destination never falls through to a screen that is not its own.
 * RequireAuth already blocks such a role, so this redirect is the last line of
 * defence.
 */
export function RoleHome() {
  const role = useSessionStore((state) => state.role);
  switch (resolveRoleHome(role)) {
    case 'DRIVER_CONSOLE':
      return <DriverConsolePage />;
    case 'CITIZEN_MAP':
      return <CitizenMapPage />;
    default:
      return <Navigate to="/login" replace />;
  }
}

/** Route table for this unit: login + the citizen and driver screens. */
export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<RoleChrome />}>
          <Route path="/" element={<RoleHome />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
