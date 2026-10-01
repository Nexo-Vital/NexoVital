import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFleetStore } from '@/features/flota/fleet-store';
import { useInventarioStore } from '@/features/recursos/inventory-store';
import { useSessionStore } from '@/features/usuarios/session';
import { setToken } from '@/services/apiClient';
import { FakeRealtimePort } from '@/test/fake-realtime-port';
import DriverConsolePage from './DriverConsolePage';

/**
 * The driver screen must show each aid center WITH its real level. `/mapa` alone
 * cannot: it carries no inventory, so a center read from it alone derives
 * "Sin declarar". These cases prove the screen hydrates the inventory from the
 * backend (the same source the citizen screen uses) and feeds the SAME
 * `centerLevel` rule through `withInventario`.
 */

// Leaflet needs a real layout engine; the map is not what this file asserts.
vi.mock('@/features/mapa/MapCanvas', () => ({
  MapCanvas: () => <div data-testid="map-canvas" />,
}));

/**
 * The centers exactly as `GET /api/v1/mapa` returns them: identity, type and
 * location, but NO inventory (`items` is always empty). The level can only come
 * from the inventory read these cases stub below.
 */
const { MAP_CENTERS } = vi.hoisted(() => ({
  MAP_CENTERS: [
    {
      id: 'centro-suba',
      nombre: 'Acopio Suba Norte',
      tipo: 'CENTRO_ACOPIO',
      ubicacion: { lat: 4.742, lng: -74.09 },
      items: [],
    },
    {
      id: 'centro-tibabuyes',
      nombre: 'Acopio Tibabuyes',
      tipo: 'CENTRO_ACOPIO',
      ubicacion: { lat: 4.73, lng: -74.1 },
      items: [],
    },
  ],
}));

vi.mock('@/features/mapa/use-map-data', () => ({
  useMapData: () => ({
    centros: MAP_CENTERS,
    zonas: [],
    loading: false,
    error: null,
    refresh: () => undefined,
  }),
}));

vi.mock('@/features/mapa/routing-api', () => ({
  fetchRuta: vi.fn(() => new Promise(() => {})),
}));

/** Minimal Response stand-in: apiFetch only reads status, ok, headers.get, json. */
function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

/** Wire inventory item, as `GET /centros-acopio/{id}/inventario` sends it. */
function wireItem(id: string, centroId: string, semaforo: 'ROJO' | 'AMARILLO' | 'VERDE') {
  return {
    id,
    centroAcopioId: centroId,
    nombre: 'Agua potable',
    disponible: semaforo === 'VERDE' ? 90 : 1,
    requerido: 100,
    semaforo,
  };
}

function driverRail() {
  return screen.getByRole('complementary', { name: 'Panel del conductor' });
}

function centersPanel() {
  return screen.getByRole('region', { name: 'Centros de acopio cercanos' });
}

/** The interactive row (a button) whose accessible name carries the center. */
function centerRow(fullName: string): HTMLElement {
  return within(centersPanel()).getByRole('button', { name: new RegExp(fullName) });
}

/**
 * The level chip text of the rail row that carries the center's full name. The
 * chip is the last `<span>` inside the row's button (the chevron is an svg, so
 * it is not a span), not the last child: the chevron sits after it.
 */
function railLevel(fullName: string): string {
  const row = within(driverRail()).getByText(fullName).closest('li');
  const spans = row?.querySelector('button')?.querySelectorAll('span');
  return spans?.[spans.length - 1]?.textContent ?? '';
}

describe('DriverConsolePage aid-center levels from the real inventory', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv('VITE_DEMO_MODE', '0');
    localStorage.clear();
    useInventarioStore.getState().reset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    useSessionStore.setState({
      user: { id: 'driver-1', nombre: 'Driver', email: 'c@nexovital.co', rol: 'CONDUCTOR' },
      role: 'CONDUCTOR',
      token: 'jwt.test',
    });
    // `apiFetch` reads the persisted token from storage, not the session store.
    setToken('jwt.test');
  });

  afterEach(() => {
    cleanup();
    useFleetStore.getState().hydrate([]);
    useInventarioStore.getState().reset();
    useSessionStore.setState({ user: null, role: null, token: null });
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('reads each center inventory and shows the real level on the rail', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      const inventory = url.match(/centros-acopio\/([^/]+)\/inventario/);
      if (inventory) {
        const centroId = inventory[1];
        if (centroId === 'centro-suba') {
          return Promise.resolve(mockResponse(200, [wireItem('i-suba', centroId, 'ROJO')]));
        }
        return Promise.resolve(mockResponse(200, [wireItem('i-tibabuyes', centroId, 'AMARILLO')]));
      }
      return Promise.resolve(mockResponse(200, []));
    });

    render(<DriverConsolePage port={new FakeRealtimePort()} />);

    // The inventory is read per center through `apiFetch`.
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/centros-acopio/centro-suba/inventario',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer jwt.test' }),
      }),
    );

    // The red inventory makes the center CRITICO and the amber one EN ALERTA on
    // the driver rail, from the same `centerLevel` rule the citizen screen uses.
    await waitFor(() => expect(railLevel('Acopio Suba Norte')).toBe('Crítico'));
    expect(railLevel('Acopio Tibabuyes')).toBe('En alerta');

    // The hydrated state is the shared inventory store, one entry per center.
    expect(useInventarioStore.getState().itemsByCentro['centro-suba']).toHaveLength(1);
    expect(useInventarioStore.getState().itemsByCentro['centro-tibabuyes']).toHaveLength(1);
  });

  it('shows "Sin declarar" when the map carries no inventory (the defect this fixes)', async () => {
    // No inventory answers: `/mapa` alone has no items, so the level is unknown.
    fetchMock.mockImplementation(() => Promise.resolve(mockResponse(200, [])));

    render(<DriverConsolePage port={new FakeRealtimePort()} />);

    await waitFor(() => expect(railLevel('Acopio Suba Norte')).toBe('Sin declarar'));
    expect(railLevel('Acopio Tibabuyes')).toBe('Sin declarar');
  });

  it('starts collapsed and expands only the clicked center inline in its own row', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('centro-suba')) {
        return Promise.resolve(mockResponse(200, [wireItem('i-suba', 'centro-suba', 'ROJO')]));
      }
      return Promise.resolve(mockResponse(200, []));
    });

    render(<DriverConsolePage port={new FakeRealtimePort()} />);

    // At rest the panel is fully collapsed: no detail and every row collapsed.
    expect(within(centersPanel()).queryByTestId('aid-center-detail')).not.toBeInTheDocument();
    for (const row of within(centersPanel()).getAllByRole('button')) {
      expect(row).toHaveAttribute('aria-expanded', 'false');
    }

    await waitFor(() => expect(railLevel('Acopio Suba Norte')).toBe('Crítico'));

    const row = centerRow('Acopio Suba Norte');
    await user.click(row);

    // Only the clicked row opens, and its detail lives INSIDE that same <li>:
    // it is not a shared block at the bottom of the list.
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(centerRow('Acopio Tibabuyes')).toHaveAttribute('aria-expanded', 'false');
    const detail = within(centersPanel()).getByTestId('aid-center-detail');
    expect(row.closest('li')?.contains(detail)).toBe(true);
    // The detail lists the center's real inventory: name + level + quantity.
    expect(within(detail).getByText('Agua potable')).toBeInTheDocument();
    expect(within(detail).getByText('Crítico')).toBeInTheDocument();
    expect(within(detail).getByText('1/100')).toBeInTheDocument();

    // Clicking the open row collapses it again.
    await user.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(within(centersPanel()).queryByTestId('aid-center-detail')).not.toBeInTheDocument();
  });

  it('keeps a single center open at a time', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('centro-suba')) {
        return Promise.resolve(mockResponse(200, [wireItem('i-suba', 'centro-suba', 'ROJO')]));
      }
      if (url.includes('centro-tibabuyes')) {
        return Promise.resolve(
          mockResponse(200, [wireItem('i-tib', 'centro-tibabuyes', 'AMARILLO')]),
        );
      }
      return Promise.resolve(mockResponse(200, []));
    });

    render(<DriverConsolePage port={new FakeRealtimePort()} />);
    await waitFor(() => expect(railLevel('Acopio Suba Norte')).toBe('Crítico'));

    await user.click(centerRow('Acopio Suba Norte'));
    expect(centerRow('Acopio Suba Norte')).toHaveAttribute('aria-expanded', 'true');

    await user.click(centerRow('Acopio Tibabuyes'));

    // Opening the second collapses the first: exactly one open row and detail.
    expect(centerRow('Acopio Suba Norte')).toHaveAttribute('aria-expanded', 'false');
    expect(centerRow('Acopio Tibabuyes')).toHaveAttribute('aria-expanded', 'true');
    const details = within(centersPanel()).getAllByTestId('aid-center-detail');
    expect(details).toHaveLength(1);
    expect(centerRow('Acopio Tibabuyes').closest('li')?.contains(details[0])).toBe(true);
  });

  it('toggles the row with the keyboard (Enter and Space)', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(() => Promise.resolve(mockResponse(200, [])));

    render(<DriverConsolePage port={new FakeRealtimePort()} />);

    const row = centerRow('Acopio Suba Norte');
    row.focus();

    await user.keyboard('{Enter}');
    expect(row).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard(' ');
    expect(row).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows an honest empty state when the center declares no inventory', async () => {
    const user = userEvent.setup();
    // No inventory answers: the center keeps the `items: []` `/mapa` sent.
    fetchMock.mockImplementation(() => Promise.resolve(mockResponse(200, [])));

    render(<DriverConsolePage port={new FakeRealtimePort()} />);
    await waitFor(() => expect(railLevel('Acopio Suba Norte')).toBe('Sin declarar'));

    await user.click(centerRow('Acopio Suba Norte'));

    const detail = within(centersPanel()).getByTestId('aid-center-detail');
    expect(within(detail).getByText('Este centro no declara inventario.')).toBeInTheDocument();
  });
});
