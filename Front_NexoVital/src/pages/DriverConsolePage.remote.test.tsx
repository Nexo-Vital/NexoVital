import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDriverOnlineStore } from '@/features/conductor/driver-online-store';
import { useEmergencyStore } from '@/features/emergencias/emergency-store';
import { useFleetStore } from '@/features/flota/fleet-store';
import { useSolicitudesStore } from '@/features/solicitudes/solicitudes-store';
import { useSessionStore } from '@/features/usuarios/session';
import { setToken } from '@/services/apiClient';
import { DESTINATIONS, type SolicitudBroadcastPayload } from '@/shared/realtime';
import { FakeRealtimePort } from '@/test/fake-realtime-port';
import type { SolicitudAmbulancia } from '@/types/domain';
import DriverConsolePage from './DriverConsolePage';

/**
 * FIX3 against the real backend: `VITE_DEMO_MODE` off, no `ambulanceId` prop.
 * The driver's OWN unit now comes from the server-scoped
 * `GET /flota/ambulancias/mia` (the general fleet list no longer exposes any
 * driver id), so the winner the server pushes (a real ambulance UUID) can be
 * recognised. In demo mode the mock mapping still resolves the unit.
 */

const DRIVER_USER_ID = 'usr-real-driver';
const REAL_UNIT = '8b6f2f0e-0000-4000-8000-0000000000a2';
const OTHER_UNIT = '8b6f2f0e-0000-4000-8000-0000000000a9';

/** General fleet read-model: no conductorId (it is not part of the projection). */
const FLEET = [
  {
    id: OTHER_UNIT,
    placa: 'ABC909',
    estado: 'DISPONIBLE',
    ubicacion: { lat: 4.7, lng: -74.06 },
    zona: 'Suba',
  },
  {
    id: REAL_UNIT,
    placa: 'ABC202',
    estado: 'DISPONIBLE',
    ubicacion: { lat: 4.745, lng: -74.095 },
    zona: 'Suba',
  },
];

/** The caller's own unit, as `GET /flota/ambulancias/mia` answers it. */
const MIA_UNIT = {
  id: REAL_UNIT,
  placa: 'ABC202',
  estado: 'DISPONIBLE',
  ubicacion: { lat: 4.745, lng: -74.095 },
  zona: 'Suba',
};

const BROADCAST: SolicitudBroadcastPayload = {
  type: 'solicitud.broadcast',
  requestId: 'REQ-REAL-1',
  emergenciaId: 'EMG-002',
  zonaId: 'Kennedy',
  tipo: 'Traffic collision',
  nivel: 'HIGH',
  escena: { lat: 4.628, lng: -74.148 },
  timeoutEn: new Date(Date.now() + 45_000).toISOString(),
  timeoutMs: 45_000,
  notificadas: [REAL_UNIT],
};

// Leaflet needs a real layout engine; the map is not what this file asserts.
vi.mock('@/features/mapa/MapCanvas', () => ({
  MapCanvas: () => <div data-testid="map-canvas" />,
}));

// The map source is the only other network path; stub it to no centers/zones.
vi.mock('@/features/mapa/use-map-data', () => ({
  useMapData: () => ({ centros: [], zonas: [], loading: false, error: null }),
}));

vi.mock('@/features/mapa/routing-api', () => ({
  fetchRuta: vi.fn(() => new Promise(() => {})),
}));

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

/**
 * Connects the driver console from a test. The page starts DISCONNECTED, so
 * cases that need offers/registry on screen connect first; the connection flows
 * themselves are covered in DriverConsolePage.test.tsx.
 */
function connectDriver(): void {
  act(() => useDriverOnlineStore.getState().goOnline());
}

/** Serves the general fleet list and the driver's own-unit resource. */
function stubBackendReads(miaBody: unknown) {
  return (path: string) =>
    Promise.resolve(
      path.endsWith('/ambulancias/mia') ? mockResponse(200, miaBody) : mockResponse(200, FLEET),
    );
}

describe('DriverConsolePage against the real backend', () => {
  const fetchMock = vi.fn();
  const port = new FakeRealtimePort();

  beforeEach(() => {
    vi.stubEnv('VITE_DEMO_MODE', '0');
    localStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    useSessionStore.setState({
      user: { id: DRIVER_USER_ID, nombre: 'Driver', email: 'c@nexovital.co', rol: 'CONDUCTOR' },
      role: 'CONDUCTOR',
      token: 'jwt.test',
    });
  });

  afterEach(() => {
    cleanup();
    useDriverOnlineStore.setState({ online: false });
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    localStorage.clear();
    useSessionStore.setState({ user: null, role: null, token: null });
  });

  it('resolves the driver unit from the server-scoped /mia resource', async () => {
    fetchMock.mockImplementation(stubBackendReads(MIA_UNIT));

    render(<DriverConsolePage port={port} />);

    // The server names the unit the driver owns.
    expect(await screen.findByText('ABC202')).toBeInTheDocument();
  });

  it('FIX3: the driver gets the mission when the server winner is its OWN unit', async () => {
    fetchMock.mockImplementation(stubBackendReads(MIA_UNIT));
    render(<DriverConsolePage port={port} />);
    await screen.findByText('ABC202');

    act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));
    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        type: 'request.taken',
        requestId: 'REQ-REAL-1',
        winner: REAL_UNIT,
      }),
    );

    expect(screen.getByText('Misión actual')).toBeInTheDocument();
  });

  it('FIX3: the driver does NOT get the mission when the winner is another unit', async () => {
    fetchMock.mockImplementation(stubBackendReads(MIA_UNIT));
    render(<DriverConsolePage port={port} />);
    await screen.findByText('ABC202');
    // The "taken" feedback lives in the request card, so surface it while online.
    connectDriver();

    act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));
    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        type: 'request.taken',
        requestId: 'REQ-REAL-1',
        winner: OTHER_UNIT,
      }),
    );

    expect(screen.queryByText('Misión actual')).not.toBeInTheDocument();
    const rail = screen.getByRole('complementary', { name: 'Panel del conductor' });
    expect(within(rail).getByRole('status')).toHaveTextContent(`Tomada por ${OTHER_UNIT}`);
  });

  /**
   * A PENDING registry row this unit was notified about, injected as a prop so
   * the page never receives it as the inbox broadcast. It exists to prove the
   * inline detail answers the SELECTED row by its own id.
   */
  function notifiedRegistryRow(id: string): SolicitudAmbulancia {
    return {
      id,
      emergenciaId: '',
      estado: 'PENDING',
      centroAyudaId: '',
      zonaId: 'Kennedy',
      ubicacion: { lat: 4.6, lng: -74.1 },
      tipo: 'Traffic collision',
      solicitadaEn: new Date(Date.now() - 60_000).toISOString(),
      timeoutEn: new Date(Date.now() + 45_000).toISOString(),
      ambulanciasNotificadas: [REAL_UNIT],
      notifiedCount: 1,
      ambulanciaAsignadaId: null,
    };
  }

  /** Reads the fleet, the emergencies and `mia`, plus one accept response. */
  function stubReadsWithAccept(
    requestId: string,
    response: () => Response,
  ): (input: RequestInfo | URL) => Promise<Response> {
    return (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/ambulancias/mia')) {
        return Promise.resolve(mockResponse(200, MIA_UNIT));
      }
      if (url.includes('/flota/ambulancias')) {
        return Promise.resolve(mockResponse(200, FLEET));
      }
      if (url.includes('/emergencias')) {
        return Promise.resolve(mockResponse(200, []));
      }
      if (url.endsWith(`/solicitudes/${requestId}/accept`)) {
        return Promise.resolve(response());
      }
      return Promise.resolve(mockResponse(200, []));
    };
  }

  it('RES-3: accepting a selected row POSTs accept with that row id, not the inbox broadcast', async () => {
    const user = userEvent.setup();
    const REQUEST_ID = '8b6f2f0e-0000-4000-8000-0000000000c1';
    const row = notifiedRegistryRow(REQUEST_ID);
    fetchMock.mockImplementation(
      stubReadsWithAccept(REQUEST_ID, () =>
        mockResponse(200, {
          ganador: true,
          solicitud: { ...row, estado: 'ASIGNADA', ambulanciaAsignadaId: REAL_UNIT },
        }),
      ),
    );

    render(<DriverConsolePage port={port} solicitudes={[row]} />);
    await screen.findByText('ABC202');
    connectDriver();

    const rail = screen.getByRole('complementary', { name: 'Panel del conductor' });
    const list = within(rail).getByRole('list', { name: 'Lista de solicitudes' });
    await user.click(within(list).getByRole('button', { name: /#8b6f2f/ }));

    const detail = within(rail).getByTestId('solicitud-detail');
    const accept = within(detail).getByRole('button', { name: 'Aceptar' });
    expect(accept).toBeEnabled();
    await user.click(accept);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v1/solicitudes/${REQUEST_ID}/accept`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ ambulanciaId: REAL_UNIT }),
        }),
      ),
    );
  });

  it('RES-4: a lost CAS is shown honestly and never as a win', async () => {
    const user = userEvent.setup();
    const REQUEST_ID = '8b6f2f0e-0000-4000-8000-0000000000c2';
    const row = notifiedRegistryRow(REQUEST_ID);
    fetchMock.mockImplementation(
      stubReadsWithAccept(REQUEST_ID, () =>
        mockResponse(409, { codigo: 'CAS_PERDIDO', mensaje: 'Otra unidad aceptó primero.' }),
      ),
    );

    render(<DriverConsolePage port={port} solicitudes={[row]} />);
    await screen.findByText('ABC202');
    connectDriver();

    const rail = screen.getByRole('complementary', { name: 'Panel del conductor' });
    const list = within(rail).getByRole('list', { name: 'Lista de solicitudes' });
    await user.click(within(list).getByRole('button', { name: /#8b6f2f/ }));

    const detail = within(rail).getByTestId('solicitud-detail');
    await user.click(within(detail).getByRole('button', { name: 'Aceptar' }));

    // The server's own message is surfaced; the UI never fabricates a win.
    await waitFor(() =>
      expect(within(detail).getByRole('status')).toHaveTextContent('Otra unidad aceptó primero.'),
    );
    expect(screen.queryByText('Misión actual')).not.toBeInTheDocument();
    expect(screen.queryByText('Te la asignaron')).not.toBeInTheDocument();
  });

  it('FIX B: accept is disabled and explained while the own unit is unresolved', async () => {
    // The server-scoped read answers "no unit": the driver's id is unresolved.
    fetchMock.mockImplementation(stubBackendReads(null));
    render(<DriverConsolePage port={port} />);
    connectDriver();

    // The backend delivers a per-user WIRE frame (no L3 filter), so the request
    // is visible even though the driver's unit is not resolved yet.
    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        solicitudId: 'REQ-REAL-1',
        emergenciaId: 'EMG-002',
        zonaId: 'Kennedy',
        estado: 'PENDIENTE',
        ambulanciasNotificadas: [REAL_UNIT],
        ambulanciaAsignadaId: null,
      }),
    );

    const card = within(
      screen.getByRole('complementary', { name: 'Panel del conductor' }),
    ).getByRole('region', { name: 'Solicitud de ambulancia' });
    expect(within(card).getByRole('button', { name: 'Aceptar solicitud' })).toBeDisabled();
    expect(within(card).getByRole('button', { name: 'Rechazar' })).toBeDisabled();
    expect(
      within(card).getByText(/Todavía no podemos identificar tu ambulancia/),
    ).toBeInTheDocument();
  });
});

/**
 * Real wire emergencies (`GET /api/v1/emergencias`): UUID ids, never `EMG-…`.
 * The contract sends the Spanish `nivel`/`estado`; `fromWireEmergency` maps them.
 */
const WIRE_EMERGENCIAS = [
  {
    id: '7f6f2f0e-0000-4000-8000-0000000000bb',
    ubicacion: { lat: 4.728, lng: -74.078 },
    nivel: 'ALTO',
    estado: 'REGISTRADA',
    descripcion: 'Reporte real',
    zonaId: 'Z-SUBA',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

/**
 * Source discipline off demo mode: the driver console must read the fleet and the
 * emergencies from the backend and start the request registry EMPTY, never
 * hydrating the fixtures. A leftover `A-…`/`EMG-…`/`REQ-…` id is exactly the mock
 * leak that used to reach the driver's inbox and the accept/reject path.
 */
describe('DriverConsolePage source discipline off demo mode', () => {
  const fetchMock = vi.fn();
  const port = new FakeRealtimePort();

  beforeEach(() => {
    vi.stubEnv('VITE_DEMO_MODE', '0');
    localStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    // `apiFetch` reads the persisted token, not the session store.
    setToken('jwt.test');
    useSessionStore.setState({
      user: { id: DRIVER_USER_ID, nombre: 'Driver', email: 'c@nexovital.co', rol: 'CONDUCTOR' },
      role: 'CONDUCTOR',
      token: 'jwt.test',
    });
  });

  afterEach(() => {
    cleanup();
    useDriverOnlineStore.setState({ online: false });
    useFleetStore.getState().hydrate([]);
    useEmergencyStore.getState().hydrate([]);
    useSolicitudesStore.getState().hydrate([]);
    useSessionStore.setState({ user: null, role: null, token: null });
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('hydrates the fleet and emergencies from the backend and starts requests empty', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/ambulancias/mia')) {
        return Promise.resolve(mockResponse(200, MIA_UNIT));
      }
      if (url.includes('/flota/ambulancias')) {
        return Promise.resolve(mockResponse(200, FLEET));
      }
      if (url.includes('/emergencias')) {
        return Promise.resolve(mockResponse(200, WIRE_EMERGENCIAS));
      }
      return Promise.resolve(mockResponse(200, []));
    });

    render(<DriverConsolePage port={port} />);
    // The registry/empty state is the connected offer surface.
    connectDriver();

    // The backend is the source: both endpoints are read (apiFetch adds the token).
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/flota/ambulancias',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer jwt.test' }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/emergencias',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer jwt.test' }),
      }),
    );

    await waitFor(() =>
      expect(useFleetStore.getState().units.map((unit) => unit.id)).toEqual(
        FLEET.map((unit) => unit.id),
      ),
    );
    await waitFor(() =>
      expect(useEmergencyStore.getState().items.map((item) => item.id)).toEqual([
        WIRE_EMERGENCIAS[0].id,
      ]),
    );

    // The stores REPLACED their contents: no fixture id survived next to a
    // backend one, and the request registry is EMPTY (there is no listing
    // endpoint; it is fed only by the realtime push).
    expect(useFleetStore.getState().units.some((unit) => unit.id.startsWith('A-'))).toBe(false);
    expect(useEmergencyStore.getState().items.some((item) => item.id.startsWith('EMG-'))).toBe(
      false,
    );
    expect(useSolicitudesStore.getState().items).toEqual([]);

    // Neither the card nor the registry can show a fixture request id.
    const rail = screen.getByRole('complementary', { name: 'Panel del conductor' });
    expect(within(rail).queryByText(/REQ-\d+/)).not.toBeInTheDocument();
    expect(within(rail).getByText('Sin solicitudes por ahora')).toBeInTheDocument();
  });
});
