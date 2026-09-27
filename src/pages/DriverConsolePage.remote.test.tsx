import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '@/features/usuarios/session';
import { DESTINATIONS, type SolicitudBroadcastPayload } from '@/shared/realtime';
import { FakeRealtimePort } from '@/test/fake-realtime-port';
import DriverConsolePage from './DriverConsolePage';

/**
 * FIX3 against the real backend: `VITE_DEMO_MODE` off, no `ambulanceId` prop.
 * The driver resolves its OWN unit from `GET /flota/ambulancias` by
 * `conductorId`, so the winner the server pushes (a real ambulance UUID) can be
 * recognised. In demo mode the mock mapping still resolves the unit.
 */

const DRIVER_USER_ID = 'usr-real-driver';
const REAL_UNIT = '8b6f2f0e-0000-4000-8000-0000000000a2';
const OTHER_UNIT = '8b6f2f0e-0000-4000-8000-0000000000a9';

const FLEET = [
  {
    id: OTHER_UNIT,
    placa: 'ABC909',
    estado: 'DISPONIBLE',
    ubicacion: { lat: 4.7, lng: -74.06 },
    zona: 'Suba',
    conductorId: 'otro-conductor',
  },
  {
    id: REAL_UNIT,
    placa: 'ABC202',
    estado: 'DISPONIBLE',
    ubicacion: { lat: 4.745, lng: -74.095 },
    zona: 'Suba',
    conductorId: DRIVER_USER_ID,
  },
];

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

/** A live-shaped `GET /flota/ambulancias` body. */
function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
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

  it('resolves the driver unit from the server fleet by conductorId', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, FLEET));

    render(<DriverConsolePage port={port} />);

    // The server fleet names the unit the driver owns.
    expect(await screen.findByText(`${REAL_UNIT} · ABC202`)).toBeInTheDocument();
  });

  it('FIX3: the driver gets the mission when the server winner is its OWN unit', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, FLEET));
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
    fetchMock.mockResolvedValue(mockResponse(200, FLEET));
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
});
