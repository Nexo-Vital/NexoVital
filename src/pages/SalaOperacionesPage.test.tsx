import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '@/features/usuarios/session';
import SalaOperacionesPage from './SalaOperacionesPage';

// Leaflet needs a real layout engine; stub the map so the CRUE shell is tested
// in isolation (fleet panel + request registry empty state).
vi.mock('@/features/mapa/MapCanvas', () => ({
  MapCanvas: () => <div data-testid="map-canvas" />,
}));

describe('SalaOperacionesPage', () => {
  beforeEach(() => {
    useSessionStore.setState({ role: 'ADMIN_CENTRO_AYUDA', token: 'mock.test' });
  });

  afterEach(() => {
    // Vitest runs with globals:false, so RTL's automatic cleanup is not
    // registered; unmount explicitly to keep the dock render isolated.
    cleanup();
    useSessionStore.setState({ user: null, role: null, token: null });
  });

  it('renders the fleet panel and the empty request registry state', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SalaOperacionesPage ambulancias={[]} emergencias={[]} solicitudes={[]} centrosAyuda={[]} />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Fleet')).toBeInTheDocument();
    expect(screen.getByText('No active requests')).toBeInTheDocument();
    expect(await screen.findByText('No units available.')).toBeInTheDocument();
    expect(screen.getByTestId('map-canvas')).toBeInTheDocument();

    // The detail rail resolves after its own artificial delay and mounts the
    // contextual Tabs, exercising the right-rail empty states.
    expect(await screen.findByRole('tab', { name: 'Request' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Unit' })).toBeInTheDocument();
    expect(await screen.findByText(/No request selected/)).toBeInTheDocument();
  });

  it('exposes the mobile dock and opens a panel without unmounting the map', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SalaOperacionesPage ambulancias={[]} emergencias={[]} solicitudes={[]} centrosAyuda={[]} />
      </MemoryRouter>,
    );

    // The map is mounted before the panel switch...
    expect(screen.getByTestId('map-canvas')).toBeInTheDocument();

    const fleetButton = screen.getByRole('button', { name: 'Open fleet panel' });
    expect(fleetButton).toBeInTheDocument();
    expect(fleetButton).toHaveAttribute('aria-expanded', 'false');

    await user.click(fleetButton);

    // ...and the sheet reveals the fleet panel on top of it, without swapping
    // the map out (both variants coexist; the breakpoint switch is CSS-only).
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Fleet' })).toBeInTheDocument();
    expect(fleetButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('map-canvas')).toBeInTheDocument();
  });
});
