import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toaster } from '@/components/ui/toast';
import { useCitizenRequestStore } from '@/features/ciudadano/citizen-request-store';
import { useEmergencyStore } from '@/features/emergencias/emergency-store';
import { useFleetStore } from '@/features/flota/fleet-store';
import type { MapaResponse } from '@/features/mapa/map-api';
import { useSolicitudesStore } from '@/features/solicitudes/solicitudes-store';
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
    // fails to read, so no inventory is known and this case keeps asserting the
    // map source only (an inventory read AND empty would mean "complete").
    fetchMock.mockImplementation((input: RequestInfo | URL) =>
      Promise.resolve(
        String(input).includes('/inventario')
          ? mockResponse(500, { mensaje: 'Sin inventario' })
          : mockResponse(200, RESPONSE),
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

/**
 * Real wire emergencies (`GET /api/v1/emergencias`): UUID ids, no `EMG-…`.
 * The contract sends the Spanish `nivel`/`estado`; `fromWireEmergency` maps them.
 */
const WIRE_EMERGENCIAS = [
  {
    id: '7f6f2f0e-0000-4000-8000-0000000000aa',
    ubicacion: { lat: 4.728, lng: -74.078 },
    nivel: 'ALTO',
    estado: 'REGISTRADA',
    descripcion: 'Reporte real',
    zonaId: 'Z-SUBA',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

/**
 * Off demo mode EVERY source is the backend: the page must request
 * `GET /api/v1/emergencias` and REPLACE the store with it, never hydrate the
 * `MOCK_EMERGENCIAS` fixtures. A leftover `EMG-002` in the store is exactly the
 * id that used to reach `POST /solicitudes` and produce a raw 400.
 */
describe('CitizenMapPage emergency/request source off demo mode', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv('VITE_DEMO_MODE', '0');
    localStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/emergencias')) {
        return Promise.resolve(mockResponse(200, WIRE_EMERGENCIAS));
      }
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
    useEmergencyStore.getState().hydrate([]);
    useSolicitudesStore.getState().hydrate([]);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('hydrates emergencies from the backend and leaks no fixture id; requests start empty', async () => {
    render(<CitizenMapPage port={new FakeRealtimePort()} />);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/emergencias',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer jwt.test' }),
      }),
    );

    await waitFor(() =>
      expect(useEmergencyStore.getState().items.map((emergency) => emergency.id)).toEqual([
        WIRE_EMERGENCIAS[0].id,
      ]),
    );
    // The store REPLACED its contents: no fixture id could survive next to a
    // backend one.
    expect(useEmergencyStore.getState().items.some((item) => item.id.startsWith('EMG-'))).toBe(
      false,
    );

    // There is no request listing endpoint: off demo the registry is EMPTY, not
    // the `MOCK_SOLICITUDES` seed.
    expect(useSolicitudesStore.getState().items).toEqual([]);
  });

  it('EP-04.F2.US9: on load it rereads the citizen request and asks to confirm an arrival already declared', async () => {
    const arrived = {
      id: '8b6f2f0e-0000-4000-8000-000000000099',
      ubicacion: { lat: 4.728, lng: -74.078 },
      emergenciaId: null,
      estado: 'ASIGNADA',
      centroAyudaId: null,
      zonaId: null,
      solicitadaEn: '2026-01-01T00:00:00.000Z',
      timeoutEn: '2026-01-01T00:01:00.000Z',
      ambulanciasNotificadas: [WIRE_FLEET[0].id],
      ambulanciaAsignadaId: WIRE_FLEET[0].id,
      llegadaEn: '2026-01-01T00:10:00.000Z',
    };
    const routed = fetchMock.getMockImplementation();
    fetchMock.mockImplementation((input: RequestInfo | URL) =>
      String(input).endsWith('/solicitudes/mias')
        ? Promise.resolve(mockResponse(200, [arrived]))
        : routed?.(input),
    );
    try {
      render(<CitizenMapPage port={new FakeRealtimePort()} />);

      expect(await screen.findByRole('dialog', { name: 'Confirmar llegada' })).toBeInTheDocument();
      expect(useCitizenRequestStore.getState()).toMatchObject({
        phase: 'arrived',
        requestId: arrived.id,
        arrivedAt: Date.parse(arrived.llegadaEn),
      });
    } finally {
      useCitizenRequestStore.getState().reset();
    }
  });
});

/**
 * Donation off demo mode: the server caps a donation to what the center still
 * needs. The donor who loses the race (409 NECESIDAD_CUBIERTA) gets the backend
 * message, and one who offers more than is missing is told what really entered.
 */
describe('CitizenMapPage donation off demo mode', () => {
  const fetchMock = vi.fn();
  const NEED = {
    id: 'item-agua',
    centroAcopioId: 'ORG-SUBA',
    nombre: 'Agua',
    disponible: 0,
    requerido: 10,
    semaforo: 'ROJO',
  };

  function mockBackend(donation: Response) {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/inventario/donacion') && init?.method === 'POST') {
        return Promise.resolve(donation);
      }
      if (url.includes('/centros-acopio/ORG-SUBA/inventario')) {
        return Promise.resolve(mockResponse(200, [NEED]));
      }
      if (url.includes('/inventario')) {
        return Promise.resolve(mockResponse(200, []));
      }
      return Promise.resolve(mockResponse(200, RESPONSE));
    });
  }

  async function openDonationDialog(container: HTMLElement) {
    await waitFor(() => {
      fireEvent.click(markerByLabel(container, 'Suba Norte'));
      expect(screen.getByRole('button', { name: 'Donar a este centro' })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Donar a este centro' }));
    const dialog = await screen.findByRole('dialog', { name: 'Donar a Acopio Suba Norte' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar donación' }));
  }

  beforeEach(() => {
    vi.stubEnv('VITE_DEMO_MODE', '0');
    localStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    setToken('jwt.test');
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('shows the backend message to the donor who lost the race and closes the dialog', async () => {
    mockBackend(
      mockResponse(409, {
        codigo: 'NECESIDAD_CUBIERTA',
        mensaje: 'Otro donante cubrió esta necesidad.',
      }),
    );
    const { container } = render(
      <>
        <CitizenMapPage
          port={new FakeRealtimePort()}
          ambulancias={[]}
          emergencias={[]}
          solicitudes={[]}
          centrosAyuda={[]}
        />
        <Toaster />
      </>,
    );

    await openDonationDialog(container);

    expect(await screen.findByText('Otro donante cubrió esta necesidad.')).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Donar a Acopio Suba Norte' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('registers only the first click when "Confirmar donación" is pressed repeatedly', async () => {
    let answer: (response: Response) => void = () => undefined;
    mockBackend(mockResponse(200, NEED));
    const fallback = fetchMock.getMockImplementation();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/inventario/donacion') && init?.method === 'POST') {
        return new Promise<Response>((resolve) => {
          answer = resolve;
        });
      }
      return fallback?.(input, init);
    });
    const { container } = render(
      <CitizenMapPage
        port={new FakeRealtimePort()}
        ambulancias={[]}
        emergencias={[]}
        solicitudes={[]}
        centrosAyuda={[]}
      />,
    );

    await openDonationDialog(container);
    const dialog = screen.getByRole('dialog', { name: 'Donar a Acopio Suba Norte' });
    const confirm = within(dialog).getByRole('button', { name: 'Registrando donación…' });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    const donations = () =>
      fetchMock.mock.calls.filter(
        ([input, init]) =>
          String(input).includes('/inventario/donacion') &&
          (init as RequestInit | undefined)?.method === 'POST',
      );
    expect(donations()).toHaveLength(1);

    answer(mockResponse(200, { ...NEED, disponible: 5, cantidadAceptada: 5, cantidadOfrecida: 5 }));
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Donar a Acopio Suba Norte' }),
      ).not.toBeInTheDocument(),
    );
    expect(donations()).toHaveLength(1);
  });

  it('tells the donor what really entered when the server accepts less than offered', async () => {
    mockBackend(
      mockResponse(200, {
        ...NEED,
        disponible: 10,
        semaforo: 'COMPLETO',
        cantidadAceptada: 4,
        cantidadOfrecida: 10,
      }),
    );
    const { container } = render(
      <>
        <CitizenMapPage
          port={new FakeRealtimePort()}
          ambulancias={[]}
          emergencias={[]}
          solicitudes={[]}
          centrosAyuda={[]}
        />
        <Toaster />
      </>,
    );

    await openDonationDialog(container);

    expect(
      await screen.findByText(
        'Se aceptaron 4 de las 10 unidades: era lo que faltaba para completar la necesidad.',
      ),
    ).toBeInTheDocument();
  });
});
