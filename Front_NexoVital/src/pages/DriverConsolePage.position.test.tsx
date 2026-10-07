import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDriverOnlineStore } from '@/features/conductor/driver-online-store';
import { useEmergencyStore } from '@/features/emergencias/emergency-store';
import { useFleetStore } from '@/features/flota/fleet-store';
import { useSolicitudesStore } from '@/features/solicitudes/solicitudes-store';
import { useSessionStore } from '@/features/usuarios/session';
import { setToken } from '@/services/apiClient';
import { DESTINATIONS } from '@/shared/realtime';
import { FakeRealtimePort } from '@/test/fake-realtime-port';
import DriverConsolePage from './DriverConsolePage';

/**
 * EP-04.F1.US1, P14: against the real backend (`VITE_DEMO_MODE` off) the driver
 * console reports its position by REST and NEVER writes on /topic/flota. The
 * channel is one-way: the server persists the report and it is the server that
 * publishes it.
 */

const DRIVER_USER_ID = 'usr-real-driver';
const REAL_UNIT = '8b6f2f0e-0000-4000-8000-0000000000a2';

const MIA_UNIT = {
  id: REAL_UNIT,
  placa: 'ABC202',
  estado: 'DISPONIBLE',
  ubicacion: { lat: 4.745, lng: -74.095 },
  zona: 'Suba',
  sinSenal: false,
  ultimaPosicionEn: null,
  version: 0,
};

// Leaflet needs a real layout engine; the map is not what this file asserts.
vi.mock('@/features/mapa/MapCanvas', () => ({
  MapCanvas: () => <div data-testid="map-canvas" />,
}));

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

/** Every call the page made to the position resource, as `[url, options]`. */
function positionCalls(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit][] {
  return (fetchMock.mock.calls as [string, RequestInit | undefined][])
    .filter(([url]) => String(url).endsWith('/posicion'))
    .map(([url, options]) => [String(url), options ?? {}]);
}

describe('DriverConsolePage position report off demo mode', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv('VITE_DEMO_MODE', '0');
    localStorage.clear();
    fetchMock.mockReset();
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/ambulancias/mia') || url.endsWith('/posicion')) {
        return Promise.resolve(mockResponse(200, MIA_UNIT));
      }
      if (url.includes('/flota/ambulancias')) {
        return Promise.resolve(mockResponse(200, [MIA_UNIT]));
      }
      return Promise.resolve(mockResponse(200, []));
    });
    vi.stubGlobal('fetch', fetchMock);
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

  it('P14: reports the own position by REST and publishes nothing on /topic/flota', async () => {
    const user = userEvent.setup();
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} />);
    await screen.findByText('ABC202');

    act(() => useDriverOnlineStore.getState().goOnline());
    await user.click(screen.getByRole('button', { name: 'Simular posición' }));

    await waitFor(() => expect(positionCalls(fetchMock)).toHaveLength(1));
    const [[url, options]] = positionCalls(fetchMock);
    expect(url).toBe(`/api/v1/flota/ambulancias/${REAL_UNIT}/posicion`);
    expect(options.method).toBe('POST');
    expect(options.headers).toMatchObject({ Authorization: 'Bearer jwt.test' });
    const body = JSON.parse(String(options.body)) as { ubicacion: { lat: number; lng: number } };
    expect(typeof body.ubicacion.lat).toBe('number');
    expect(typeof body.ubicacion.lng).toBe('number');

    // One-way channel: the client never writes the position on the topic.
    expect(port.published.filter((frame) => frame.destination === DESTINATIONS.flota)).toEqual([]);
  });

  it('does not report while the driver is disconnected', async () => {
    const user = userEvent.setup();
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} />);
    await screen.findByText('ABC202');

    await user.click(screen.getByRole('button', { name: 'Simular posición' }));
    // Give a report the chance to leave before asserting that none did.
    await act(async () => {
      await Promise.resolve();
    });

    expect(positionCalls(fetchMock)).toEqual([]);
    expect(port.published.filter((frame) => frame.destination === DESTINATIONS.flota)).toEqual([]);
  });

  it('does not echo back the position the server already holds for the unit', async () => {
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} />);
    await screen.findByText('ABC202');

    // Connected, but with no GPS fix and no simulated position: the only
    // position on screen is the unit's stored one, which is not the driver's.
    act(() => useDriverOnlineStore.getState().goOnline());
    await act(async () => {
      await Promise.resolve();
    });

    expect(positionCalls(fetchMock)).toEqual([]);
    expect(port.published.filter((frame) => frame.destination === DESTINATIONS.flota)).toEqual([]);
  });
});
