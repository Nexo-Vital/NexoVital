import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useSessionStore } from '@/features/usuarios/session';
import type { RolUsuario } from '@/types/domain';
import { AppRouter, RoleHome } from './AppRouter';

vi.mock('@/pages/SalaOperacionesPage', () => ({
  default: () => <div data-testid="operations-room" />,
}));
vi.mock('@/pages/DriverConsolePage', () => ({
  default: () => <div data-testid="driver-console" />,
}));
vi.mock('@/pages/CitizenMapPage', () => ({
  default: () => <div data-testid="citizen-map" />,
}));

// AppShell (the compact chrome for non-citizen roles) owns the realtime
// connection and the channel badge; both are irrelevant to shell selection.
vi.mock('@/shared/realtime/use-realtime-connection', () => ({
  useRealtimeConnection: () => undefined,
}));
vi.mock('@/features/observabilidad/use-channel-status', () => ({
  useChannelStatus: () => ({ state: 'CONNECTED', latencyMs: null }),
}));
// Token revalidation is not under test: RequireAuth just passes through.
vi.mock('@/features/usuarios/guards', async () => {
  const { Outlet } = await import('react-router-dom');
  return { RequireAuth: () => <Outlet /> };
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

  it.each(['ADMIN_PLATAFORMA', 'ADMIN_CENTRO_AYUDA', 'ADMIN_ACOPIO'] as const)(
    'routes %s to the operations room',
    (role) => {
      signInAs(role);
      renderHome();

      expect(screen.getByTestId('operations-room')).toBeInTheDocument();
      expect(screen.queryByTestId('driver-console')).not.toBeInTheDocument();
    },
  );

  it('routes CONDUCTOR to the driver console', () => {
    signInAs('CONDUCTOR');
    renderHome();

    expect(screen.getByTestId('driver-console')).toBeInTheDocument();
    expect(screen.queryByTestId('operations-room')).not.toBeInTheDocument();
  });

  it('routes CIUDADANO to the citizen map, never to another role screen', () => {
    signInAs('CIUDADANO');
    renderHome();

    expect(screen.getByTestId('citizen-map')).toBeInTheDocument();
    expect(screen.queryByTestId('operations-room')).not.toBeInTheDocument();
    expect(screen.queryByTestId('driver-console')).not.toBeInTheDocument();
  });
});

describe('AppRouter shell selection', () => {
  beforeEach(() => useSessionStore.setState({ user: null, role: null, token: null }));
  afterEach(() => {
    cleanup();
    useSessionStore.setState({ user: null, role: null, token: null });
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
    expect(screen.queryByText('CRUE Operations')).not.toBeInTheDocument();
  });

  it('keeps the compact shell for the CRUE roles', () => {
    signInAs('ADMIN_CENTRO_AYUDA');
    renderApp();

    expect(screen.getByText('CRUE Operations')).toBeInTheDocument();
    expect(screen.queryByText('NexoVital')).not.toBeInTheDocument();
  });

  it('gives the driver the v2 frame with the unit suffix in the topbar', () => {
    signInAs('CONDUCTOR');
    renderApp();

    expect(screen.getAllByText('NexoVital').length).toBeGreaterThan(0);
    expect(screen.queryByText('CRUE Operations')).not.toBeInTheDocument();
    expect(screen.getByText('Conductor de ambulancia · A-07')).toBeInTheDocument();

    const bar = screen.getByRole('complementary', { name: 'Barra lateral' });
    expect(within(bar).getByText('Mapa')).toHaveAttribute('aria-current', 'page');
    expect(within(bar).getByText('Solicitudes')).not.toHaveAttribute('aria-current');
    expect(within(bar).getByText('Mi unidad')).not.toHaveAttribute('aria-current');
  });
});
