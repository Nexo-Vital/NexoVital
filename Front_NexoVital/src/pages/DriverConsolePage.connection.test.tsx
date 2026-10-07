import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToastStore } from '@/components/ui/toast';
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
 * EP-04.F2.US1, D3 and D6: against the real backend (`VITE_DEMO_MODE` off) the
 * driver's connection is the unit's `conectada`. The console shows what the
 * server holds, the two buttons are REST commands, and the requests the push did
 * not deliver are read back every time the driver is connected.
 */

const DRIVER_USER_ID = 'usr-real-driver';
const REAL_UNIT = '8b6f2f0e-0000-4000-8000-0000000000a2';
const OTHER_UNIT = '8b6f2f0e-0000-4000-8000-0000000000a3';
const REQUEST = '8b6f2f0e-0000-4000-8000-0000000000c1';

interface WireUnit {
  id: string;
  placa: string;
  estado: string;
  ubicacion: { lat: number; lng: number };
  zona: string;
  sinSenal: boolean;
  ultimaPosicionEn: string | null;
  version: number;
  conectada: boolean;
}

function wireUnit(overrides: Partial<WireUnit> = {}): WireUnit {
  return {
    id: REAL_UNIT,
    placa: 'ABC202',
    estado: 'DISPONIBLE',
    ubicacion: { lat: 4.745, lng: -74.095 },
    zona: 'Suba',
    sinSenal: false,
    ultimaPosicionEn: null,
    version: 3,
    conectada: true,
    ...overrides,
  };
}

function wirePending(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Date.now();
  return {
    id: REQUEST,
    ubicacion: { lat: 4.75, lng: -74.09 },
    emergenciaId: null,
    estado: 'PENDIENTE',
    centroAyudaId: null,
    zonaId: null,
    solicitadaEn: new Date(now - 10_000).toISOString(),
    timeoutEn: new Date(now + 50_000).toISOString(),
    ambulanciasNotificadas: [REAL_UNIT, OTHER_UNIT],
    ambulanciaAsignadaId: null,
    llegadaEn: null,
    ...overrides,
  };
}

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

/**
 * What the fake backend holds. The handlers read it on every call, so a test
 * changes the server's truth by changing these fields.
 */
interface Backend {
  unit: WireUnit;
  pendientes: unknown[];
  historial: unknown[];
  /** Answer of `desconectar`; null means "apply it". */
  desconectarError: { status: number; body: unknown } | null;
}

describe('DriverConsolePage connection off demo mode', () => {
  const fetchMock = vi.fn();
  let backend: Backend;

  /** Calls the page made to a route, matched by its ending. */
  function callsTo(suffix: string): [string, RequestInit][] {
    return (fetchMock.mock.calls as [string, RequestInit | undefined][])
      .filter(([url]) => String(url).endsWith(suffix))
      .map(([url, options]) => [String(url), options ?? {}]);
  }

  function unitPanel(): HTMLElement {
    return screen.getByRole('region', { name: 'Tu ambulancia' });
  }

  beforeEach(() => {
    vi.stubEnv('VITE_DEMO_MODE', '0');
    localStorage.clear();
    backend = { unit: wireUnit(), pendientes: [], historial: [], desconectarError: null };
    fetchMock.mockReset();
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/mia/conectar')) {
        backend.unit = { ...backend.unit, conectada: true, version: backend.unit.version + 1 };
        return Promise.resolve(mockResponse(200, backend.unit));
      }
      if (url.endsWith('/mia/desconectar')) {
        if (backend.desconectarError) {
          return Promise.resolve(
            mockResponse(backend.desconectarError.status, backend.desconectarError.body),
          );
        }
        backend.unit = { ...backend.unit, conectada: false, version: backend.unit.version + 1 };
        return Promise.resolve(mockResponse(200, backend.unit));
      }
      if (url.endsWith('/mia/disponibilidad')) {
        const { disponible } = JSON.parse(String(init?.body)) as { disponible: boolean };
        backend.unit = {
          ...backend.unit,
          estado: disponible ? 'DISPONIBLE' : 'MANTENIMIENTO',
          version: backend.unit.version + 1,
        };
        return Promise.resolve(mockResponse(200, backend.unit));
      }
      if (url.endsWith('/mia/solicitudes/pendientes')) {
        return Promise.resolve(mockResponse(200, backend.pendientes));
      }
      if (url.endsWith('/finalizar')) {
        // The server closes the request and releases the unit in one operation.
        backend.unit = { ...backend.unit, estado: 'DISPONIBLE', version: backend.unit.version + 1 };
        return Promise.resolve(
          mockResponse(200, wirePending({ estado: 'TOMADA', ambulanciaAsignadaId: REAL_UNIT })),
        );
      }
      if (url.endsWith('/mia/solicitudes')) {
        return Promise.resolve(mockResponse(200, backend.historial));
      }
      if (url.endsWith('/ambulancias/mia')) {
        return Promise.resolve(mockResponse(200, backend.unit));
      }
      if (url.includes('/flota/ambulancias')) {
        return Promise.resolve(mockResponse(200, [backend.unit]));
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
    useToastStore.setState({ toasts: [] });
    useSessionStore.setState({ user: null, role: null, token: null });
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('shows the connection the server holds, without pressing anything', async () => {
    render(<DriverConsolePage port={new FakeRealtimePort()} />);
    await screen.findByText('ABC202');

    expect(await within(unitPanel()).findByText('En línea')).toBeInTheDocument();
    expect(within(unitPanel()).getByRole('button', { name: 'Desconectarse' })).toBeEnabled();
    expect(callsTo('/mia/conectar')).toEqual([]);
  });

  it('starts disconnected when the server says so, and reads no pending request', async () => {
    backend.unit = wireUnit({ conectada: false });
    backend.pendientes = [wirePending()];
    render(<DriverConsolePage port={new FakeRealtimePort()} />);
    await screen.findByText('ABC202');

    expect(await within(unitPanel()).findByText('Desconectado')).toBeInTheDocument();
    expect(screen.getByTestId('solicitudes-offline')).toBeInTheDocument();
    expect(callsTo('/mia/solicitudes/pendientes')).toEqual([]);
  });

  it('"Conectarse" is a REST command; then the pending request reappears', async () => {
    const user = userEvent.setup();
    backend.unit = wireUnit({ conectada: false });
    backend.pendientes = [wirePending()];
    render(<DriverConsolePage port={new FakeRealtimePort()} />);
    await within(unitPanel()).findByText('Desconectado');

    await user.click(within(unitPanel()).getByRole('button', { name: 'Conectarse' }));

    expect(await within(unitPanel()).findByText('En línea')).toBeInTheDocument();
    const [[url, options]] = callsTo('/mia/conectar');
    expect(url).toBe('/api/v1/flota/ambulancias/mia/conectar');
    expect(options.method).toBe('POST');
    // D6: the request the push did not deliver is read back and surfaced.
    const card = await screen.findByRole('region', { name: 'Solicitud de ambulancia' });
    expect(within(card).getByRole('button', { name: 'Aceptar solicitud' })).toBeEnabled();
    expect(useSolicitudesStore.getState().items.map((item) => item.id)).toEqual([REQUEST]);
  });

  it('"Desconectarse" is a REST command; the offer leaves the screen', async () => {
    const user = userEvent.setup();
    backend.pendientes = [wirePending()];
    render(<DriverConsolePage port={new FakeRealtimePort()} />);
    await screen.findByRole('region', { name: 'Solicitud de ambulancia' });

    await user.click(within(unitPanel()).getByRole('button', { name: 'Desconectarse' }));

    expect(await within(unitPanel()).findByText('Desconectado')).toBeInTheDocument();
    expect(callsTo('/mia/desconectar')).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'Solicitud de ambulancia' })).toBeNull();
    expect(screen.getByTestId('solicitudes-offline')).toBeInTheDocument();
  });

  it('reconnecting before the request expires brings it back', async () => {
    const user = userEvent.setup();
    backend.pendientes = [wirePending()];
    render(<DriverConsolePage port={new FakeRealtimePort()} />);
    await screen.findByRole('region', { name: 'Solicitud de ambulancia' });

    await user.click(within(unitPanel()).getByRole('button', { name: 'Desconectarse' }));
    await within(unitPanel()).findByText('Desconectado');
    await user.click(within(unitPanel()).getByRole('button', { name: 'Conectarse' }));

    expect(
      await screen.findByRole('region', { name: 'Solicitud de ambulancia' }),
    ).toBeInTheDocument();
  });

  it('follows a disconnection decided by the server (frame on /topic/flota)', async () => {
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} />);
    await within(unitPanel()).findByText('En línea');

    // The driver's last session ended somewhere else: the server says so.
    act(() =>
      port.emit(DESTINATIONS.flota, {
        ambulanciaId: REAL_UNIT,
        estado: 'DISPONIBLE',
        conectada: false,
        version: 9,
      }),
    );

    expect(await within(unitPanel()).findByText('Desconectado')).toBeInTheDocument();
    expect(callsTo('/mia/desconectar')).toEqual([]);
  });

  it('reads the unit again when the channel connects after the first read', async () => {
    // After a reload the page reads the fleet before its channel is up, and the
    // server may disconnect the unit (the old session ending) right after that
    // read: the frame is published to nobody.
    const port = new FakeRealtimePort();
    port.state = 'DISCONNECTED';
    render(<DriverConsolePage port={port} />);
    await within(unitPanel()).findByText('En línea');

    backend.unit = wireUnit({ conectada: false, version: 4 });
    act(() => port.setState('CONNECTED'));

    expect(await within(unitPanel()).findByText('Desconectado')).toBeInTheDocument();
  });

  it('reads the pending requests again when the realtime channel comes back', async () => {
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} />);
    await within(unitPanel()).findByText('En línea');
    await waitFor(() => expect(callsTo('/mia/solicitudes/pendientes')).toHaveLength(1));

    // A request was published while the channel was down: the broker never
    // resends it, so only the read brings it.
    backend.pendientes = [wirePending()];
    act(() => port.setState('STALE'));
    act(() => port.setState('CONNECTED'));

    expect(
      await screen.findByRole('region', { name: 'Solicitud de ambulancia' }),
    ).toBeInTheDocument();
    expect(callsTo('/mia/solicitudes/pendientes').length).toBeGreaterThanOrEqual(2);
  });

  it('shows the reason of the server when it refuses to disconnect (409)', async () => {
    const user = userEvent.setup();
    backend.desconectarError = {
      status: 409,
      body: {
        codigo: 'SOLICITUD_EN_CURSO',
        mensaje: 'Finaliza el servicio en curso para poder desconectarte.',
      },
    };
    render(<DriverConsolePage port={new FakeRealtimePort()} />);
    await within(unitPanel()).findByText('En línea');

    await user.click(within(unitPanel()).getByRole('button', { name: 'Desconectarse' }));

    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((item) => item.message)).toContain(
        'Finaliza el servicio en curso para poder desconectarte.',
      ),
    );
    expect(within(unitPanel()).getByText('En línea')).toBeInTheDocument();
  });

  it('warns a connected driver whose unit has no signal', async () => {
    backend.unit = wireUnit({ sinSenal: true });
    render(<DriverConsolePage port={new FakeRealtimePort()} />);
    await within(unitPanel()).findByText('En línea');

    expect(
      within(unitPanel()).getByText(/Tu ambulancia está sin señal y no recibirá solicitudes/),
    ).toBeInTheDocument();
  });

  it('does not warn about the signal while the unit has it', async () => {
    render(<DriverConsolePage port={new FakeRealtimePort()} />);
    await within(unitPanel()).findByText('En línea');

    expect(within(unitPanel()).queryByText(/sin señal/)).toBeNull();
  });

  it('keeps the two buttons waiting until the unit is read from the server', async () => {
    let release: (response: Response) => void = () => {};
    const defaultImplementation = fetchMock.getMockImplementation();
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      if (String(input).endsWith('/flota/ambulancias')) {
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      }
      return defaultImplementation?.(input) as Promise<Response>;
    });
    render(<DriverConsolePage port={new FakeRealtimePort()} />);

    // The real connection is still unknown: nothing can be toggled yet.
    expect(within(unitPanel()).getByRole('button', { name: 'Conectarse' })).toBeDisabled();

    await act(async () => {
      release(mockResponse(200, [backend.unit]));
    });
    expect(await within(unitPanel()).findByText('En línea')).toBeInTheDocument();
  });

  it('"Fuera de servicio" is a REST command: the server stops sending requests', async () => {
    const user = userEvent.setup();
    backend.pendientes = [wirePending()];
    render(<DriverConsolePage port={new FakeRealtimePort()} />);
    await screen.findByRole('region', { name: 'Solicitud de ambulancia' });

    await user.click(within(unitPanel()).getByRole('button', { name: 'Fuera de servicio' }));

    await waitFor(() =>
      expect(
        within(unitPanel()).getByRole('button', { name: 'Fuera de servicio' }),
      ).toHaveAttribute('aria-pressed', 'true'),
    );
    const [[url, options]] = callsTo('/mia/disponibilidad');
    expect(url).toBe('/api/v1/flota/ambulancias/mia/disponibilidad');
    expect(options.method).toBe('POST');
    expect(JSON.parse(String(options.body))).toEqual({ disponible: false });
    // The server now holds the unit out of service, and the offer is gone.
    expect(backend.unit.estado).toBe('MANTENIMIENTO');
    expect(screen.queryByRole('region', { name: 'Solicitud de ambulancia' })).toBeNull();
    expect(screen.getByText('Marca «Disponible» para recibir solicitudes')).toBeInTheDocument();
    // Still connected: out of service is not a disconnection.
    expect(within(unitPanel()).getByText('En línea')).toBeInTheDocument();
  });

  it('"Disponible" brings the unit back and its pending request with it', async () => {
    const user = userEvent.setup();
    backend.unit = wireUnit({ estado: 'MANTENIMIENTO' });
    backend.pendientes = [wirePending()];
    render(<DriverConsolePage port={new FakeRealtimePort()} />);
    await within(unitPanel()).findByText('En línea');

    // Out of service on the server: that is the pressed state, and no pending
    // request is even asked for.
    await waitFor(() =>
      expect(
        within(unitPanel()).getByRole('button', { name: 'Fuera de servicio' }),
      ).toHaveAttribute('aria-pressed', 'true'),
    );
    expect(callsTo('/mia/solicitudes/pendientes')).toEqual([]);

    await user.click(within(unitPanel()).getByRole('button', { name: 'Disponible' }));

    expect(
      await screen.findByRole('region', { name: 'Solicitud de ambulancia' }),
    ).toBeInTheDocument();
    expect(JSON.parse(String(callsTo('/mia/disponibilidad')[0]?.[1].body))).toEqual({
      disponible: true,
    });
    expect(within(unitPanel()).getByRole('button', { name: 'Disponible' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('"En ruta" and "En escena" cannot be pressed; they follow the mission', async () => {
    backend.unit = wireUnit({ estado: 'EN_MISION' });
    backend.historial = [wirePending({ estado: 'ASIGNADA', ambulanciaAsignadaId: REAL_UNIT })];
    render(<DriverConsolePage port={new FakeRealtimePort()} />);
    await screen.findByRole('button', { name: 'Declarar llegada' });

    const enRuta = within(unitPanel()).getByRole('button', { name: 'En ruta' });
    expect(enRuta).toHaveAttribute('aria-pressed', 'true');
    expect(enRuta).toBeDisabled();
    expect(within(unitPanel()).getByRole('button', { name: 'En escena' })).toBeDisabled();
    // Attending a request, nothing is declared by hand either.
    expect(within(unitPanel()).getByRole('button', { name: 'Disponible' })).toBeDisabled();
    expect(within(unitPanel()).getByRole('button', { name: 'Fuera de servicio' })).toBeDisabled();
  });

  it('a mission whose arrival is declared reads "En escena"', async () => {
    backend.unit = wireUnit({ estado: 'EN_MISION' });
    backend.historial = [
      wirePending({
        estado: 'ASIGNADA',
        ambulanciaAsignadaId: REAL_UNIT,
        llegadaEn: new Date(Date.now() - 5_000).toISOString(),
      }),
    ];
    render(<DriverConsolePage port={new FakeRealtimePort()} />);
    await screen.findByRole('button', { name: 'Finalizar servicio' });

    expect(within(unitPanel()).getByRole('button', { name: 'En escena' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('another unit accepts: the card and the row leave at once, with one notice', async () => {
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} />);
    await within(unitPanel()).findByText('En línea');
    // The request arrives by the push, as the server sends it to each driver.
    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        solicitudId: REQUEST,
        ubicacion: { lat: 4.75, lng: -74.09 },
        emergenciaId: null,
        zonaId: null,
        estado: 'PENDIENTE',
        ambulanciasNotificadas: [REAL_UNIT, OTHER_UNIT],
        ambulanciaAsignadaId: null,
        llegada: false,
      }),
    );
    await screen.findByRole('region', { name: 'Solicitud de ambulancia' });
    expect(screen.getByRole('list', { name: 'Lista de solicitudes' })).toBeInTheDocument();

    // The other unit won: the server tells every notified unit.
    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        solicitudId: REQUEST,
        ubicacion: null,
        emergenciaId: null,
        zonaId: null,
        estado: 'ASIGNADA',
        ambulanciasNotificadas: [],
        ambulanciaAsignadaId: OTHER_UNIT,
        llegada: false,
      }),
    );

    // Nothing stays for 45 s: no card, no row, no mission.
    expect(screen.queryByRole('region', { name: 'Solicitud de ambulancia' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Lista de solicitudes' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Declarar llegada' })).toBeNull();
    const notices = useToastStore
      .getState()
      .toasts.map((item) => item.message)
      .filter((message) => message === 'La solicitud ya fue aceptada por otra ambulancia.');
    expect(notices).toHaveLength(1);
  });

  it('names the own unit by its plate among the notified units', async () => {
    const user = userEvent.setup();
    backend.pendientes = [wirePending({ ambulanciasNotificadas: [REAL_UNIT] })];
    render(<DriverConsolePage port={new FakeRealtimePort()} />);
    await screen.findByRole('region', { name: 'Solicitud de ambulancia' });

    const list = screen.getByRole('list', { name: 'Lista de solicitudes' });
    await user.click(within(list).getByRole('button'));

    const detail = screen.getByTestId('solicitud-detail');
    expect(within(detail).getByText('ABC202')).toBeInTheDocument();
    // Never the internal id of the unit.
    expect(within(detail).queryByText(new RegExp(REAL_UNIT))).toBeNull();
  });

  it('reopens the mission the unit holds on the server and blocks "Desconectarse"', async () => {
    backend.unit = wireUnit({ estado: 'EN_MISION' });
    backend.historial = [
      wirePending({ estado: 'ASIGNADA', ambulanciaAsignadaId: REAL_UNIT }),
      wirePending({
        id: '8b6f2f0e-0000-4000-8000-0000000000c9',
        estado: 'TOMADA',
        ambulanciaAsignadaId: REAL_UNIT,
      }),
    ];
    render(<DriverConsolePage port={new FakeRealtimePort()} />);
    await screen.findByText('ABC202');

    // After a reload the mission exists only on the server: it is read back.
    expect(await screen.findByRole('button', { name: 'Declarar llegada' })).toBeInTheDocument();
    const disconnect = within(unitPanel()).getByRole('button', { name: 'Desconectarse' });
    expect(disconnect).toBeDisabled();
    expect(
      within(unitPanel()).getByText('Finaliza el servicio para desconectarte.'),
    ).toBeInTheDocument();
  });

  it('does not offer a pending row while the unit attends a service', async () => {
    backend.unit = wireUnit({ estado: 'EN_MISION' });
    backend.historial = [wirePending({ estado: 'ASIGNADA', ambulanciaAsignadaId: REAL_UNIT })];
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} />);
    await screen.findByRole('button', { name: 'Declarar llegada' });

    // A request this unit was notified of before it became busy is still open.
    act(() =>
      useSolicitudesStore.getState().upsert({
        id: '8b6f2f0e-0000-4000-8000-0000000000d1',
        emergenciaId: '',
        estado: 'PENDING',
        centroAyudaId: '',
        zonaId: '',
        tipo: '',
        solicitadaEn: new Date().toISOString(),
        timeoutEn: '',
        ambulanciasNotificadas: [REAL_UNIT],
        notifiedCount: 1,
        ambulanciaAsignadaId: null,
      }),
    );

    expect(screen.queryByRole('list', { name: 'Lista de solicitudes' })).toBeNull();
  });

  it('finishing the service brings the request that was opened meanwhile', async () => {
    const user = userEvent.setup();
    const LATE = '8b6f2f0e-0000-4000-8000-0000000000e1';
    backend.unit = wireUnit({ estado: 'EN_MISION' });
    backend.historial = [
      wirePending({
        estado: 'ASIGNADA',
        ambulanciaAsignadaId: REAL_UNIT,
        llegadaEn: new Date().toISOString(),
      }),
    ];
    render(<DriverConsolePage port={new FakeRealtimePort()} />);
    const finish = await screen.findByRole('button', { name: 'Finalizar servicio' });
    // While the unit was busy the server answered no pending request.
    const readsBefore = callsTo('/mia/solicitudes/pendientes').length;

    // Another citizen asked while this unit was busy; once the unit is free the
    // server adds it to that request, which is still open.
    backend.pendientes = [
      wirePending({ id: LATE, ambulanciasNotificadas: [OTHER_UNIT, REAL_UNIT] }),
    ];
    await user.click(finish);

    const card = await screen.findByRole('region', { name: 'Solicitud de ambulancia' });
    expect(within(card).getByRole('button', { name: 'Aceptar solicitud' })).toBeEnabled();
    expect(callsTo('/mia/solicitudes/pendientes').length).toBeGreaterThan(readsBefore);
    expect(useSolicitudesStore.getState().items.some((item) => item.id === LATE)).toBe(true);
  });

  it('keeps a late offer that arrives a moment before the mission is closed', async () => {
    const user = userEvent.setup();
    const LATE = '8b6f2f0e-0000-4000-8000-0000000000e2';
    backend.unit = wireUnit({ estado: 'EN_MISION' });
    backend.historial = [
      wirePending({
        estado: 'ASIGNADA',
        ambulanciaAsignadaId: REAL_UNIT,
        llegadaEn: new Date().toISOString(),
      }),
    ];
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} />);
    const finish = await screen.findByRole('button', { name: 'Finalizar servicio' });
    const now = Date.now();

    // The server pushes after its commit, so the offer can reach the console
    // before the answer of "finalizar" does. The pending read finds nothing new.
    await user.click(finish);
    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        solicitudId: LATE,
        ubicacion: { lat: 4.75, lng: -74.09 },
        emergenciaId: null,
        zonaId: null,
        estado: 'PENDIENTE',
        ambulanciasNotificadas: [OTHER_UNIT, REAL_UNIT],
        ambulanciaAsignadaId: null,
        llegada: false,
        solicitadaEn: new Date(now - 30_000).toISOString(),
        timeoutEn: new Date(now + 30_000).toISOString(),
      }),
    );

    const card = await screen.findByRole('region', { name: 'Solicitud de ambulancia' });
    expect(within(card).getByRole('button', { name: 'Aceptar solicitud' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Finalizar servicio' })).toBeNull();
  });

  it('a request offered late counts down the time it has left, not a full window', async () => {
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} />);
    await within(unitPanel()).findByText('En línea');
    const now = Date.now();

    // The frame of `SolicitudAbiertaPushListener`: the request was raised 48 s
    // ago with a 60 s window, so 12 s are left.
    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        solicitudId: REQUEST,
        ubicacion: { lat: 4.75, lng: -74.09 },
        emergenciaId: null,
        zonaId: null,
        estado: 'PENDIENTE',
        ambulanciasNotificadas: [OTHER_UNIT, REAL_UNIT],
        ambulanciaAsignadaId: null,
        llegada: false,
        solicitadaEn: new Date(now - 48_000).toISOString(),
        timeoutEn: new Date(now + 12_000).toISOString(),
      }),
    );

    const card = await screen.findByRole('region', { name: 'Solicitud de ambulancia' });
    const timer = within(card).getByRole('timer');
    expect(timer).toHaveTextContent(/^0:1[012]$/);
    // The registry row keeps the deadline of the request, never an invented one.
    const row = useSolicitudesStore.getState().items.find((item) => item.id === REQUEST);
    expect(row?.timeoutEn).toBe(new Date(now + 12_000).toISOString());
  });
});
