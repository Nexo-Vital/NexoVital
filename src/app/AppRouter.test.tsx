import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '@/features/usuarios/session';
import type { RolUsuario } from '@/types/domain';
import { RoleHome } from './AppRouter';

vi.mock('@/pages/SalaOperacionesPage', () => ({
  default: () => <div data-testid="operations-room" />,
}));
vi.mock('@/pages/DriverConsolePage', () => ({
  default: () => <div data-testid="driver-console" />,
}));
vi.mock('@/pages/CitizenMapPage', () => ({
  default: () => <div data-testid="citizen-map" />,
}));

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
