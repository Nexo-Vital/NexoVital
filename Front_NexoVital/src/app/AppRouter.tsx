import { Ambulance, ClipboardList, HandHeart, Map as MapIcon } from 'lucide-react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { formatCoordinates } from '@/features/ciudadano/citizen-request';
import { type DriverAlert, useDriverAlertsStore } from '@/features/conductor/driver-alerts-store';
import { resolveDriverAmbulanceId } from '@/features/conductor/driver-session';
import { RequireAuth, RequireRole } from '@/features/usuarios/guards';
import { resolveRoleHome } from '@/features/usuarios/role-home';
import { useSessionStore } from '@/features/usuarios/session';
import CitizenMapPage from '@/pages/CitizenMapPage';
import DriverConsolePage from '@/pages/DriverConsolePage';
import DriverHistoryPage from '@/pages/DriverHistoryPage';
import DriverUnitPage from '@/pages/DriverUnitPage';
import LoginPage from '@/pages/LoginPage';
import type { EmergencyLevel } from '@/types/domain';
import { AppFrame, type AppFrameNavItem, type AppFrameNotification } from './AppFrame';

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
 * Sidebar navigation for the driver shell. All three items now have a screen:
 * "Solicitudes" opens the service history, "Mi unidad" the driver's own unit and
 * "Mapa" the role home (the console), so every entry carries a route target and
 * is clickable.
 */
export const DRIVER_NAV: AppFrameNavItem[] = [
  { key: 'map', label: 'Mapa', icon: MapIcon, to: '/' },
  { key: 'requests', label: 'Solicitudes', icon: ClipboardList, to: '/conductor/solicitudes' },
  { key: 'unit', label: 'Mi unidad', icon: Ambulance, to: '/conductor/unidad' },
];

/**
 * Maps the current route to the sidebar key it belongs to. The two driver
 * sub-routes have their own item; every other route is the role home (the map),
 * which is where both shells land.
 */
function activeNavKey(pathname: string): string {
  if (pathname.startsWith('/conductor/solicitudes')) {
    return 'requests';
  }
  if (pathname.startsWith('/conductor/unidad')) {
    return 'unit';
  }
  return 'map';
}

/**
 * Spanish severity labels for the bell, the driver's language. A request with
 * no triage behind it carries no level and the row simply omits the chip.
 */
const LEVEL_LABEL_ES: Record<EmergencyLevel, string> = {
  LOW: 'Bajo',
  MEDIUM: 'Medio',
  HIGH: 'Alto',
  CRITICAL: 'Crítico',
};

/** Projects a pending offer onto one presentational bell notification row. */
function toBellNotification(alert: DriverAlert): AppFrameNotification {
  return {
    id: alert.requestId,
    title: alert.tipo || 'Sin clasificar',
    ...(alert.nivel ? { levelLabel: LEVEL_LABEL_ES[alert.nivel] } : {}),
    locationLabel: alert.escena ? formatCoordinates(alert.escena) : 'Sin ubicación',
    ...(Number.isFinite(Date.parse(alert.timeoutEn)) ? { timeoutEn: alert.timeoutEn } : {}),
  };
}

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
  // The offers themselves, listed in the bell; same single writer as the count.
  const pending = useDriverAlertsStore((state) => state.pending);
  // Opening a notification asks the console to select and centre that request.
  const focusRequest = useDriverAlertsStore((state) => state.focusRequest);
  // The active item follows the real route, not a fixed key.
  const { pathname } = useLocation();
  const activeKey = activeNavKey(pathname);
  const home = resolveRoleHome(role);
  if (home === 'CITIZEN_MAP') {
    return <AppFrame nav={CITIZEN_NAV} activeKey={activeKey} />;
  }
  if (home === 'DRIVER_CONSOLE') {
    return (
      <AppFrame
        nav={DRIVER_NAV}
        activeKey={activeKey}
        roleDetail={resolveDriverAmbulanceId(userId)}
        bellCount={pendingRequests}
        notifications={pending.map(toBellNotification)}
        onNotificationSelect={focusRequest}
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
          {/* Driver-only screen: a role without the driver home is sent back to
              "/" instead of rendering a screen that is not its own. */}
          <Route
            element={<RequireRole roles={['CONDUCTOR']} fallback={<Navigate to="/" replace />} />}
          >
            <Route path="/conductor/solicitudes" element={<DriverHistoryPage />} />
            <Route path="/conductor/unidad" element={<DriverUnitPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
