import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '@/features/usuarios/session';
import { DESTINATIONS, type SolicitudBroadcastPayload } from '@/shared/realtime';
import { FakeRealtimePort } from '@/test/fake-realtime-port';
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
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    localStorage.clear();
    useSessionStore.setState({ user: null, role: null, token: null });
  });

  it('resolves the driver unit from the server-scoped /mia resource', async () => {
    fetchMock.mockImplementation(stubBackendReads(MIA_UNIT));

    render(<DriverConsolePage port={port} />);

    // The server names the unit the driver owns.
    expect(await screen.findByText(`${REAL_UNIT} · ABC202`)).toBeInTheDocument();
  });

  it('FIX3: the driver gets the mission when the server winner is its OWN unit', async () => {
    fetchMock.mockImplementation(stubBackendReads(MIA_UNIT));
    render(<DriverConsolePage port={port} />);
    await screen.findByText(`${REAL_UNIT} · ABC202`);

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
    await screen.findByText(`${REAL_UNIT} · ABC202`);

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

  it('FIX B: accept is disabled and explained while the own unit is unresolved', async () => {
    // The server-scoped read answers "no unit": the driver's id is unresolved.
    fetchMock.mockImplementation(stubBackendReads(null));
    render(<DriverConsolePage port={port} />);

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
