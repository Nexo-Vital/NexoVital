import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFleetStore } from '@/features/flota/fleet-store';
import type { MapaResponse } from '@/features/mapa/map-api';
import { setToken } from '@/services/apiClient';
import { FakeRealtimePort } from '@/test/fake-realtime-port';
import CitizenMapPage from './CitizenMapPage';

// The page can trigger a third-party routing request; `msw` is not wired in this
// repo, so the routing client is mocked and this file never performs real network
// I/O beyond the stubbed `fetch` for /mapa and /inventario.
vi.mock('@/features/mapa/routing-api', () => ({
  fetchRuta: vi.fn(() => new Promise(() => {})),
}));

/** A live-shaped response: 2 zones and 3 Bogotá centers, with NO inventory. */
const RESPONSE: MapaResponse = {
  zonas: [
    {
      id: 'Z-SUBA',
      nombre: 'Suba',
      ubicacion: { lat: 4.742, lng: -74.09 },
      contorno: [
        { lat: 4.79, lng: -74.1 },
        { lat: 4.795, lng: -74.05 },
        { lat: 4.755, lng: -74.032 },
        { lat: 4.7, lng: -74.05 },
      ],
    },
    {
      id: 'Z-KENNEDY',
      nombre: 'Kennedy',
      ubicacion: { lat: 4.628, lng: -74.148 },
      contorno: [
        { lat: 4.665, lng: -74.16 },
        { lat: 4.66, lng: -74.115 },
        { lat: 4.6, lng: -74.105 },
        { lat: 4.575, lng: -74.135 },
      ],
    },
  ],
  centros: [
    {
      id: 'ORG-SUBA',
      nombre: 'Acopio Suba Norte',
      tipo: 'CENTRO_ACOPIO',
      zonaId: 'Z-SUBA',
      ubicacion: { lat: 4.742, lng: -74.09 },
    },
    {
      id: 'ORG-GAITANA',
      nombre: 'Acopio La Gaitana',
      tipo: 'CENTRO_ACOPIO',
      zonaId: 'Z-SUBA',
      ubicacion: { lat: 4.72, lng: -74.05 },
    },
    {
      id: 'ORG-TIBABUYES',
      nombre: 'Acopio Tibabuyes',
      tipo: 'CENTRO_ACOPIO',
      zonaId: 'Z-SUBA',
      ubicacion: { lat: 4.73, lng: -74.1 },
    },
  ],
};

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

/** The `.nv-marker` wrapper whose label matches, or a thrown error. */
function markerByLabel(container: HTMLElement, label: string): HTMLElement {
  const marker = Array.from(container.querySelectorAll<HTMLElement>('.nv-marker')).find(
    (element) => element.querySelector('.nv-marker__label')?.textContent === label,
  );
  if (!marker) {
    throw new Error(`marker ${label} not found`);
  }
  return marker;
}

/** The count rendered next to a legend label. */
function legendValue(label: string): string {
  const legend = screen.getByRole('complementary', { name: 'Leyenda del mapa' });
  const row = within(legend).getByText(label).closest('li');
  if (!row) {
    throw new Error(`legend row "${label}" not found`);
  }
  return row.querySelector('b')?.textContent ?? '';
}

/**
 * Real backend fleet shape (`GET /api/v1/flota/ambulancias`): uuid ids and ABC
 * plates, three free and one occupied. No id can collide with a fixture id.
 */
const WIRE_FLEET = [
  {
    id: '8b6f2f0e-0000-4000-8000-000000000101',
    placa: 'ABC101',
    estado: 'DISPONIBLE',
    ubicacion: { lat: 4.7411, lng: -74.0811 },
    zona: 'Suba',
  },
  {
    id: '8b6f2f0e-0000-4000-8000-000000000202',
    placa: 'ABC202',
    estado: 'DISPONIBLE',
    ubicacion: { lat: 4.745, lng: -74.095 },
    zona: 'Suba',
  },
  {
    id: '8b6f2f0e-0000-4000-8000-000000000303',
    placa: 'ABC303',
    estado: 'DISPONIBLE',
    ubicacion: { lat: 4.72, lng: -74.06 },
    zona: 'Suba',
  },
  {
    id: '8b6f2f0e-0000-4000-8000-000000000404',
    placa: 'ABC404',
    estado: 'EN_MISION',
    ubicacion: { lat: 4.76, lng: -74.075 },
    zona: 'Suba',
  },
];

/** The zone-area polygons currently painted on the map (expected: none). */
function zoneAreas(container: HTMLElement): Element[] {
  return Array.from(container.querySelectorAll('path.nv-zone-area'));
}

/**
 * End-to-end of the new source, without the demo flag: the citizen screen has to
 * request `GET /api/v1/mapa` and paint the backend's centers as UNDECLARED (no
 * inventory is invented). The backend still sends zones in the payload, but the
 * map must NOT paint them: "zonas afectadas" are point reports, not areas.
 */
describe('CitizenMapPage against /api/v1/mapa', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    // The map snapshot answers `/mapa`; each center's inventory read (EP-03)
    // answers an empty list, so this case keeps asserting the map source only.
    fetchMock.mockImplementation((input: RequestInfo | URL) =>
      Promise.resolve(
        String(input).includes('/inventario') ? mockResponse(200, []) : mockResponse(200, RESPONSE),
      ),
    );
    setToken('jwt.test');
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('paints the backend centers and no zone polygons', async () => {
    const { container } = render(
      <CitizenMapPage
        port={new FakeRealtimePort()}
        ambulancias={[]}
        emergencias={[]}
        solicitudes={[]}
        centrosAyuda={[]}
      />,
    );

    // The backend is the source: the endpoint is requested (apiFetch adds the token).
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/mapa',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer jwt.test' }),
      }),
    );

    // No inventory in the payload: every backend center is counted as undeclared.
    expect(await screen.findByText('3 sin declarar')).toBeInTheDocument();

    // With nothing declared there is nothing to donate to, so the mock-only flow
    // stays off with its reason instead of opening an empty screen.
    expect(screen.getByRole('button', { name: 'Donar suministros' })).toBeDisabled();

    // The payload carries TWO zones, yet the map paints NONE: a zone is a point
    // report, never an area footprint. This is the regression this change locks.
    await waitFor(() => expect(screen.getByText('3 sin declarar')).toBeInTheDocument());
    expect(zoneAreas(container)).toHaveLength(0);

    // Opening a center whose payload DOES carry a `zonaId` still paints no zone:
    // selection never derived one, and now neither does the layer. The pin is
    // RE-QUERIED INSIDE the retry and clicked there (a stale node click flakes
    // under full-suite load); the detail panel opening proves the click landed.
    await waitFor(() => {
      fireEvent.click(markerByLabel(container, 'Suba Norte'));
      expect(
        screen.getByRole('heading', { level: 1, name: 'Centro de acopio' }),
      ).toBeInTheDocument();
    });
    // Still no zone footprint after the selection.
    expect(zoneAreas(container)).toHaveLength(0);
  });

  it('AC-U1: a background click closes the open center detail', async () => {
    const { container } = render(
      <CitizenMapPage
        port={new FakeRealtimePort()}
        ambulancias={[]}
        emergencias={[]}
        solicitudes={[]}
        centrosAyuda={[]}
      />,
    );

    await waitFor(() => {
      fireEvent.click(markerByLabel(container, 'Suba Norte'));
      expect(
        screen.getByRole('heading', { level: 1, name: 'Centro de acopio' }),
      ).toBeInTheDocument();
    });

    // A click on the map BACKGROUND (the Leaflet container itself, not a marker)
    // releases the panel and brings the map title and the rail back.
    await waitFor(() => {
      fireEvent.click(container.querySelector('.leaflet-container') as HTMLElement);
      expect(
        screen.queryByRole('heading', { level: 1, name: 'Centro de acopio' }),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByRole('heading', { level: 1, name: 'Mapa de operación' }),
    ).toBeInTheDocument();
  });
});

/**
 * Off demo mode the citizen legend is a view of the REAL fleet: the page hydrates
 * from `GET /api/v1/flota/ambulancias` and never injects the fixtures, so no mock
 * id can mix with a backend id and the legend counts exactly what the backend has.
 */
describe('CitizenMapPage fleet source off demo mode', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv('VITE_DEMO_MODE', '0');
    localStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/flota/ambulancias')) {
        return Promise.resolve(mockResponse(200, WIRE_FLEET));
      }
      if (url.includes('/inventario')) {
        return Promise.resolve(mockResponse(200, []));
      }
      return Promise.resolve(mockResponse(200, RESPONSE));
    });
    setToken('jwt.test');
  });

  afterEach(() => {
    cleanup();
    useFleetStore.getState().hydrate([]);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('hydrates the fleet from the backend and leaks no fixture id', async () => {
    render(
      <CitizenMapPage
        port={new FakeRealtimePort()}
        emergencias={[]}
        solicitudes={[]}
        centrosAyuda={[]}
      />,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/flota/ambulancias',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer jwt.test' }),
      }),
    );

    await waitFor(() => expect(legendValue('Disponible')).toBe('3'));
    expect(legendValue('Ocupada')).toBe('1');

    expect(useFleetStore.getState().units.map((unit) => unit.id)).toEqual(
      WIRE_FLEET.map((unit) => unit.id),
    );
    expect(useFleetStore.getState().units.some((unit) => unit.id.startsWith('A-'))).toBe(false);
  });
});
