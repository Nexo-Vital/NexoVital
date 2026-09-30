import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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

/** The level chip text of the rail row that carries the center's full name. */
function railLevel(fullName: string): string {
  const row = within(driverRail()).getByText(fullName).closest('li');
  const chip = row?.querySelector('span:last-child');
  return chip?.textContent ?? '';
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
});
