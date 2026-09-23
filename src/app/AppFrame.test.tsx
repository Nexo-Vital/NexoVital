import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Ambulance, HandHeart, Map as MapIcon } from 'lucide-react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '@/features/usuarios/session';
import type { RolUsuario } from '@/types/domain';
import { AppFrame, type AppFrameNavItem } from './AppFrame';

// The shell owns the realtime connection; it is irrelevant to the chrome here.
vi.mock('@/shared/realtime/use-realtime-connection', () => ({
  useRealtimeConnection: () => undefined,
}));

const NAV: AppFrameNavItem[] = [
  { key: 'map', label: 'Mapa', icon: MapIcon },
  { key: 'requests', label: 'Mis solicitudes', icon: Ambulance },
  { key: 'donations', label: 'Mis donaciones', icon: HandHeart },
];

function renderFrame(role: RolUsuario = 'CIUDADANO', roleDetail?: string, bellCount?: number) {
  useSessionStore.setState({
    user: {
      id: 'usr-citizen',
      nombre: 'Ciudadano Demo',
      email: 'ciudadano@nexovital.co',
      rol: role,
    },
    role,
    token: 'jwt.test',
  });
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/login" element={<div data-testid="login-screen" />} />
        <Route
          element={
            <AppFrame nav={NAV} activeKey="map" roleDetail={roleDetail} bellCount={bellCount} />
          }
        >
          <Route path="/" element={<div data-testid="outlet-content" />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function sidebar() {
  return screen.getByRole('complementary', { name: 'Barra lateral' });
}

describe('AppFrame', () => {
  beforeEach(() => useSessionStore.setState({ user: null, role: null, token: null }));
  afterEach(() => {
    cleanup();
    useSessionStore.setState({ user: null, role: null, token: null });
  });

  it('renders the brand and the role navigation with the current item marked', () => {
    renderFrame();
    const bar = sidebar();

    expect(within(bar).getByText('NexoVital')).toBeInTheDocument();
    expect(within(bar).getByText('Mapa')).toHaveAttribute('aria-current', 'page');
    expect(within(bar).getByText('Mis solicitudes')).not.toHaveAttribute('aria-current');
    expect(within(bar).getByText('Mis donaciones')).not.toHaveAttribute('aria-current');
  });

  it('renders the routed content inside the shell', () => {
    renderFrame();
    expect(screen.getByTestId('outlet-content')).toBeInTheDocument();
  });

  it('shows the avatar initials, the name and the Spanish role', () => {
    renderFrame();

    expect(screen.getByText('CD')).toBeInTheDocument();
    expect(screen.getByText('Ciudadano Demo')).toBeInTheDocument();
    expect(screen.getByText('Ciudadano')).toBeInTheDocument();
  });

  it('appends the role detail suffix when given, e.g. the driver unit', () => {
    renderFrame('CONDUCTOR', 'A-07');

    expect(screen.getByText('Conductor de ambulancia · A-07')).toBeInTheDocument();
  });

  it('renders the search as a non-interactive hint, never an input', () => {
    renderFrame();

    expect(screen.getByText('Buscar centro de acopio o dirección').tagName).toBe('SPAN');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(document.querySelector('input')).toBeNull();
  });

  it('leaves the bell badge-less unless a count is given', () => {
    renderFrame();

    expect(screen.queryByTestId('bell-badge')).not.toBeInTheDocument();
  });

  it('renders the bell badge with the pending count when given', () => {
    renderFrame('CONDUCTOR', 'A-07', 3);

    expect(screen.getByTestId('bell-badge')).toHaveTextContent('3');
    expect(screen.getByLabelText('3 solicitudes pendientes')).toBeInTheDocument();
  });

  it('caps the bell badge at 9+', () => {
    renderFrame('CONDUCTOR', 'A-07', 12);

    expect(screen.getByTestId('bell-badge')).toHaveTextContent('9+');
  });

  it('signs out and returns to login when "Cerrar sesión" is pressed', async () => {
    const user = userEvent.setup();
    renderFrame();

    await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }));

    expect(screen.getByTestId('login-screen')).toBeInTheDocument();
    expect(useSessionStore.getState().user).toBeNull();
    expect(useSessionStore.getState().role).toBeNull();
  });

  it('never renders for a role without a screen', () => {
    renderFrame('INSPECTOR' as RolUsuario);

    expect(screen.getByTestId('login-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('outlet-content')).not.toBeInTheDocument();
  });
});
