import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useDriverAlertsStore } from '@/features/conductor/driver-alerts-store';
import { useSessionStore } from '@/features/usuarios/session';
import type { RolUsuario } from '@/types/domain';
import { AppRouter, RoleHome } from './AppRouter';

vi.mock('@/pages/DriverConsolePage', () => ({
  default: () => <div data-testid="driver-console" />,
}));
vi.mock('@/pages/CitizenMapPage', () => ({
  default: ({ centerAdmin = false }: { centerAdmin?: boolean }) => (
    <div data-testid="citizen-map" data-center-admin={String(centerAdmin)} />
  ),
}));
vi.mock('@/pages/LoginPage', () => ({
  default: () => <div data-testid="login-screen" />,
}));
vi.mock('@/pages/DriverHistoryPage', () => ({
  default: () => <div data-testid="driver-history" />,
}));
vi.mock('@/pages/DriverUnitPage', () => ({
  default: () => <div data-testid="driver-unit" />,
}));

// AppFrame (the chrome for every role that has a screen) owns the realtime
// connection; it is irrelevant to shell selection.
vi.mock('@/shared/realtime/use-realtime-connection', () => ({
  useRealtimeConnection: () => undefined,
}));
// Token revalidation is not under test: RequireAuth just passes through, and
// RequireRole renders its outlet when the role matches.
vi.mock('@/features/usuarios/guards', async () => {
  const { Outlet } = await import('react-router-dom');
  return { RequireAuth: () => <Outlet />, RequireRole: () => <Outlet /> };
});

function renderHome() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/" element={<RoleHome />} />
        <Route path="/login" element={<div data-testid="login-screen" />} />
      </Routes>
    </MemoryRouter>,
  );
}

function signInAs(role: RolUsuario) {
  useSessionStore.setState({
    user: { id: 'usr-test', nombre: 'Test', email: 'test@nexovital.co', rol: role },
    role,
    token: 'jwt.test',
  });
}

describe('RoleHome', () => {
  beforeEach(() => useSessionStore.setState({ user: null, role: null, token: null }));
  afterEach(() => {
    cleanup();
    useSessionStore.setState({ user: null, role: null, token: null });
  });

  it.each(['ADMIN_PLATAFORMA', 'ADMIN_ACOPIO'] as const)(
    'sends %s to the login screen because it has no home',
    (role) => {
      signInAs(role);
      renderHome();

      expect(screen.getByTestId('login-screen')).toBeInTheDocument();
      expect(screen.queryByTestId('driver-console')).not.toBeInTheDocument();
      expect(screen.queryByTestId('citizen-map')).not.toBeInTheDocument();
    },
  );

  it('routes CONDUCTOR to the driver console', () => {
    signInAs('CONDUCTOR');
    renderHome();

    expect(screen.getByTestId('driver-console')).toBeInTheDocument();
    expect(screen.queryByTestId('login-screen')).not.toBeInTheDocument();
  });

  it('routes CIUDADANO to the citizen map, never to another role screen', () => {
    signInAs('CIUDADANO');
    renderHome();

    expect(screen.getByTestId('citizen-map')).toHaveAttribute('data-center-admin', 'false');
    expect(screen.queryByTestId('driver-console')).not.toBeInTheDocument();
  });

  it('routes ADMIN_CENTRO_AYUDA to the map in its center-administrator variant', () => {
    signInAs('ADMIN_CENTRO_AYUDA');
    renderHome();

    expect(screen.getByTestId('citizen-map')).toHaveAttribute('data-center-admin', 'true');
    expect(screen.queryByTestId('login-screen')).not.toBeInTheDocument();
    expect(screen.queryByTestId('driver-console')).not.toBeInTheDocument();
  });
});

describe('AppRouter shell selection', () => {
  beforeEach(() => useSessionStore.setState({ user: null, role: null, token: null }));
  afterEach(() => {
    cleanup();
    useSessionStore.setState({ user: null, role: null, token: null });
    useDriverAlertsStore.setState({ pending: [], pendingRequests: 0, focusRequestId: null });
  });

  function renderApp() {
    return render(
      <TooltipProvider>
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AppRouter />
        </MemoryRouter>
      </TooltipProvider>,
    );
  }

  it('gives the citizen the v2 frame', () => {
    signInAs('CIUDADANO');
    renderApp();

    expect(screen.getAllByText('NexoVital').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('login-screen')).not.toBeInTheDocument();
  });

  it('gives the help-center administrator the v2 frame', () => {
    signInAs('ADMIN_CENTRO_AYUDA');
    renderApp();

    expect(screen.getAllByText('NexoVital').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('login-screen')).not.toBeInTheDocument();
    expect(screen.getByText('Administrador de centro de ayuda')).toBeInTheDocument();
  });

  it('sends a role without home to the login screen instead of rendering a chrome', () => {
    signInAs('ADMIN_ACOPIO');
    renderApp();

    expect(screen.getByTestId('login-screen')).toBeInTheDocument();
    expect(screen.queryByText('NexoVital')).not.toBeInTheDocument();
  });

  it('gives the driver the v2 frame with the unit suffix in the topbar', () => {
    signInAs('CONDUCTOR');
    renderApp();

    expect(screen.getAllByText('NexoVital').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('login-screen')).not.toBeInTheDocument();
    expect(screen.getByText('Conductor de ambulancia · A-07')).toBeInTheDocument();

    const bar = screen.getByRole('complementary', { name: 'Barra lateral' });
    expect(within(bar).getByText('Mapa')).toHaveAttribute('aria-current', 'page');
    expect(within(bar).getByText('Solicitudes')).not.toHaveAttribute('aria-current');
    expect(within(bar).getByText('Mi unidad')).not.toHaveAttribute('aria-current');
  });

  it('opens the driver service history and marks Solicitudes as the current route', async () => {
    const user = userEvent.setup();
    signInAs('CONDUCTOR');
    renderApp();

    const bar = screen.getByRole('complementary', { name: 'Barra lateral' });
    expect(within(bar).getByText('Mapa')).toHaveAttribute('aria-current', 'page');

    await user.click(within(bar).getByRole('link', { name: 'Solicitudes' }));

    expect(screen.getByTestId('driver-history')).toBeInTheDocument();
    expect(within(bar).getByText('Solicitudes')).toHaveAttribute('aria-current', 'page');
    expect(within(bar).getByText('Mapa')).not.toHaveAttribute('aria-current');
    // "Mi unidad" now has a real screen too, so it is a link (no longer inert)
    // and is not the current route while the history is open.
    expect(within(bar).getByRole('link', { name: 'Mi unidad' })).toBeInTheDocument();
    expect(within(bar).getByText('Mi unidad')).not.toHaveAttribute('aria-current');
  });

  it('navigates the driver between Mapa and Mi unidad and marks each current route', async () => {
    const user = userEvent.setup();
    signInAs('CONDUCTOR');
    renderApp();

    const bar = screen.getByRole('complementary', { name: 'Barra lateral' });
    expect(within(bar).getByText('Mapa')).toHaveAttribute('aria-current', 'page');

    await user.click(within(bar).getByRole('link', { name: 'Mi unidad' }));

    expect(screen.getByTestId('driver-unit')).toBeInTheDocument();
    expect(within(bar).getByText('Mi unidad')).toHaveAttribute('aria-current', 'page');
    expect(within(bar).getByText('Mapa')).not.toHaveAttribute('aria-current');
    expect(within(bar).getByText('Solicitudes')).not.toHaveAttribute('aria-current');

    await user.click(within(bar).getByRole('link', { name: 'Mapa' }));

    expect(screen.getByTestId('driver-console')).toBeInTheDocument();
    expect(within(bar).getByText('Mapa')).toHaveAttribute('aria-current', 'page');
    expect(within(bar).getByText('Mi unidad')).not.toHaveAttribute('aria-current');
  });

  it('lists the driver pending offers in the shell bell and focuses one on click', async () => {
    const user = userEvent.setup();
    signInAs('CONDUCTOR');
    useDriverAlertsStore.setState({
      pending: [
        {
          requestId: 'REQ-9',
          tipo: 'Trauma',
          nivel: 'HIGH',
          escena: { lat: 4.6, lng: -74.1 },
          timeoutEn: new Date(Date.now() + 45_000).toISOString(),
        },
      ],
      pendingRequests: 1,
      focusRequestId: null,
    });
    renderApp();

    await user.click(screen.getByRole('button', { name: 'Notificaciones' }));

    const panel = screen.getByRole('menu', { name: 'Notificaciones' });
    expect(within(panel).getByText('Trauma')).toBeInTheDocument();
    expect(within(panel).getByText('Alto')).toBeInTheDocument();

    await user.click(within(panel).getByRole('menuitem', { name: /Trauma/ }));

    expect(useDriverAlertsStore.getState().focusRequestId).toBe('REQ-9');
    expect(screen.getByTestId('driver-console')).toBeInTheDocument();
  });
});
