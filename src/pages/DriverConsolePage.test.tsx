import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToastStore } from '@/components/ui/toast';
import { useDriverAlertsStore } from '@/features/conductor/driver-alerts-store';
import { useEmergencyStore } from '@/features/emergencias/emergency-store';
import { useFleetStore } from '@/features/flota/fleet-store';
import { useSolicitudesStore } from '@/features/solicitudes/solicitudes-store';
import { MOCK_CENTROS_AYUDA, MOCK_SOLICITUDES } from '@/mocks/fixtures';
import { DESTINATIONS, type SolicitudBroadcastPayload } from '@/shared/realtime';
import { FakeRealtimePort } from '@/test/fake-realtime-port';
import type { SolicitudAmbulancia } from '@/types/domain';
import DriverConsolePage from './DriverConsolePage';

// Leaflet needs a real layout engine; stub the map so the driver unit panel, the
// rail and the request card are tested in isolation. The stub echoes the props
// this unit wires (aid centers, the self label, the requester pin, the connector
// and the notified units) so the page's data path stays asserted without a map.
vi.mock('@/features/mapa/MapCanvas', () => ({
  MapCanvas: (props: {
    centros?: unknown[];
    self?: { label?: string; simulated?: boolean } | null;
    request?: { label?: string; position?: { lat: number; lng: number } } | null;
    requestConnector?: { dashed?: boolean } | null;
    ruta?: { geometria?: unknown[] } | null;
    notifiedAmbulanceIds?: readonly string[];
    focus?: { lat: number; lng: number } | null;
  }) => (
    <div
      data-testid="map-canvas"
      data-centers={props.centros?.length ?? 0}
      data-self-label={props.self?.label ?? ''}
      data-self-sim={props.self?.simulated ? 'yes' : 'no'}
      data-request-label={props.request?.label ?? ''}
      data-request-lat={String(props.request?.position?.lat ?? '')}
      data-request-lng={String(props.request?.position?.lng ?? '')}
      data-connector={props.requestConnector ? 'yes' : 'no'}
      data-connector-dashed={props.requestConnector?.dashed === false ? 'no' : 'yes'}
      data-ruta={props.ruta ? 'yes' : 'no'}
      data-ruta-points={String(props.ruta?.geometria?.length ?? 0)}
      data-notified={(props.notifiedAmbulanceIds ?? []).join(',')}
      data-focus-lat={String(props.focus?.lat ?? '')}
      data-focus-lng={String(props.focus?.lng ?? '')}
    />
  ),
}));

// The map data source is the only network path in this screen; it is stubbed to
// the injected fixtures so the mocked suite keeps testing the page without
// setting the demo flag and without touching the backend.
vi.mock('@/features/mapa/use-map-data', () => ({
  useMapData: (fallbackCentros: unknown[]) => ({
    centros: fallbackCentros,
    zonas: [],
    loading: false,
    error: null,
  }),
}));

// The routing client is a THIRD-PARTY network call with no msw wired in this
// repo, so it is mocked out for the whole file: no page test can ever reach
// OSRM. By default the returned promise never settles (no route -> the
// straight-line fallback); the routed-duration case resolves it explicitly.
const { mockFetchRuta } = vi.hoisted(() => ({ mockFetchRuta: vi.fn() }));

vi.mock('@/features/mapa/routing-api', () => ({
  fetchRuta: mockFetchRuta,
}));

mockFetchRuta.mockReturnValue(new Promise(() => {}));

const BROADCAST: SolicitudBroadcastPayload = {
  type: 'solicitud.broadcast',
  requestId: 'REQ-1',
  emergenciaId: 'EMG-002',
  zonaId: 'Kennedy',
  tipo: 'Traffic collision',
  nivel: 'HIGH',
  escena: { lat: 4.628, lng: -74.148 },
  timeoutEn: new Date(Date.now() + 45_000).toISOString(),
  timeoutMs: 45_000,
  notificadas: ['A-07', 'A-12'],
};

/** The card value under a given row label. */
function dataRowValue(card: HTMLElement, label: string): string {
  const row = within(card).getByText(label).closest('div');
  return row?.querySelectorAll('span')[1]?.textContent ?? '';
}

function driverRail() {
  return screen.getByRole('complementary', { name: 'Panel del conductor' });
}

/** The driver-facing status chip in "Tu ambulancia". */
function driverStatusChip() {
  return screen.getByTestId('driver-status-chip');
}

/** Drives the page from a broadcast to a mission won by A-07 (`C.d4`). */
async function winMission(user: ReturnType<typeof userEvent.setup>, port: FakeRealtimePort) {
  act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));
  await user.click(screen.getByRole('button', { name: 'Aceptar solicitud' }));
  act(() =>
    port.emit(DESTINATIONS.solicitudes, {
      type: 'request.taken',
      requestId: 'REQ-1',
      winner: 'A-07',
    }),
  );
}

/** Replaces the geolocation stub; `undefined` restores the "unsupported" state. */
function setGeolocation(value: unknown): void {
  Object.defineProperty(window.navigator, 'geolocation', { value, configurable: true });
}

describe('DriverConsolePage', () => {
  beforeEach(() => {
    // This file drives the DEMO path: accept/reject must keep publishing on the
    // relay instead of calling the backend (FIX1). The REST path is covered by
    // DriverConsolePage.remote.test.tsx.
    vi.stubEnv('VITE_DEMO_MODE', '1');
  });

  afterEach(() => {
    cleanup();
    useDriverAlertsStore.setState({ pendingRequests: 0 });
    // The arrival toast lives in a module store: clear it so counts never leak.
    useToastStore.setState({ toasts: [] });
    setGeolocation(undefined);
    // Back to "no route": a case that resolved one never leaks into another.
    mockFetchRuta.mockReset();
    mockFetchRuta.mockReturnValue(new Promise(() => {}));
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('renders the map and the unit panel controls', () => {
    render(<DriverConsolePage port={new FakeRealtimePort()} ambulanceId="A-07" />);

    expect(screen.getByTestId('map-canvas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Conectarse' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Simular posición' })).toBeInTheDocument();
  });

  it('no longer renders the driver bottom sheet', () => {
    render(<DriverConsolePage port={new FakeRealtimePort()} ambulanceId="A-07" />);

    // The sheet was a region labelled "Driver controls" with English copy.
    expect(screen.queryByRole('region', { name: 'Driver controls' })).not.toBeInTheDocument();
    expect(screen.queryByText('Driver console')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /go online/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /simulate my position/i })).not.toBeInTheDocument();
  });

  it('toggles the driver connection in Spanish and marks it in the panel', async () => {
    const user = userEvent.setup();
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} ambulanceId="A-07" />);

    // Offline at first: the panel offers the connect action and says so.
    expect(screen.getByRole('button', { name: 'Conectarse' })).toBeInTheDocument();
    expect(screen.getByText('Desconectado')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Desconectarse' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Conectarse' }));

    expect(screen.getByRole('button', { name: 'Desconectarse' })).toBeInTheDocument();
    expect(screen.getByText('En línea')).toBeInTheDocument();
    // Going online also clears the off-duty state.
    expect(driverStatusChip()).toHaveTextContent('Disponible');

    // With a position, the online unit is published on /topic/flota.
    await user.click(screen.getByRole('button', { name: 'Simular posición' }));
    expect(port.published.some((frame) => frame.destination === DESTINATIONS.flota)).toBe(true);
  });

  it('marks the active driver status accessibly, not only by colour', async () => {
    const user = userEvent.setup();
    render(<DriverConsolePage port={new FakeRealtimePort()} ambulanceId="A-07" />);

    // Starts off duty: that button is the pressed one.
    expect(screen.getByRole('button', { name: 'Fuera de servicio' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Disponible' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    await user.click(screen.getByRole('button', { name: 'Disponible' }));

    expect(screen.getByRole('button', { name: 'Disponible' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Fuera de servicio' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('shows the denied-location error message in the panel', () => {
    setGeolocation({
      watchPosition: (_success: PositionCallback, error: PositionErrorCallback) => {
        error({
          code: 1,
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
          message: 'denied',
        } as GeolocationPositionError);
        return 1;
      },
      clearWatch: () => undefined,
    });

    render(<DriverConsolePage port={new FakeRealtimePort()} ambulanceId="A-07" />);

    expect(screen.getByText(/Permiso de ubicación denegado/)).toBeInTheDocument();
  });

  it('renders the header, the summary chips and the three rail panels', () => {
    render(<DriverConsolePage port={new FakeRealtimePort()} ambulanceId="A-07" />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Mapa de operación' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Suba, Bogotá · en vivo')).toBeInTheDocument();
    expect(screen.getByLabelText('Resumen de centros por semáforo')).toBeInTheDocument();

    const rail = driverRail();
    expect(within(rail).getByRole('heading', { name: 'Tu ambulancia' })).toBeInTheDocument();
    expect(within(rail).getByRole('heading', { name: 'Solicitudes' })).toBeInTheDocument();
    expect(
      within(rail).getByRole('heading', { name: 'Centros de acopio cercanos' }),
    ).toBeInTheDocument();
  });

  it('shows the own unit plate, and its chip tracks the driver status', async () => {
    const user = userEvent.setup();
    render(<DriverConsolePage port={new FakeRealtimePort()} ambulanceId="A-07" />);

    const rail = driverRail();
    expect(within(rail).getByText('WNR-418')).toBeInTheDocument();
    // The internal unit id is never painted as the unit name.
    expect(within(rail).queryByText('A-07')).not.toBeInTheDocument();
    // The mockup's "Tu ambulancia" line: model · type, not the zone.
    expect(within(rail).getByText('Renault Master 2023 · Básica (TAB)')).toBeInTheDocument();
    // Off duty is the DRIVER's state: it says "Fuera de servicio", never the
    // vehicle bucket's "En mantenimiento".
    expect(driverStatusChip()).toHaveTextContent('Fuera de servicio');
    expect(within(rail).queryByText('En mantenimiento')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Disponible' }));
    expect(driverStatusChip()).toHaveTextContent('Disponible');
    expect(driverStatusChip()).not.toHaveTextContent('Ocupada');

    await user.click(screen.getByRole('button', { name: 'En ruta' }));
    expect(driverStatusChip()).toHaveTextContent('En ruta');

    await user.click(screen.getByRole('button', { name: 'En escena' }));
    expect(driverStatusChip()).toHaveTextContent('En escena');
  });

  it('passes the aid centers to the map and labels the self marker with the unit', async () => {
    const user = userEvent.setup();
    render(<DriverConsolePage port={new FakeRealtimePort()} ambulanceId="A-07" />);

    expect(screen.getByTestId('map-canvas')).toHaveAttribute(
      'data-centers',
      String(MOCK_CENTROS_AYUDA.length),
    );

    await user.click(screen.getByRole('button', { name: 'Simular posición' }));
    expect(screen.getByTestId('map-canvas')).toHaveAttribute('data-self-label', 'Tú · WNR-418');
  });

  it('stops claiming there are no requests and renders the request card', () => {
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} ambulanceId="A-07" />);

    const rail = driverRail();
    expect(within(rail).getByText('Sin solicitudes por ahora')).toBeInTheDocument();
    expect(within(rail).getByText(/con sonido/)).toBeInTheDocument();

    act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));

    expect(within(rail).queryByText('Sin solicitudes por ahora')).not.toBeInTheDocument();
    expect(
      within(rail).getByRole('heading', { name: 'Solicitud de ambulancia' }),
    ).toBeInTheDocument();
  });

  it('renders the four data rows from the real payload fields', () => {
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} ambulanceId="A-07" />);
    act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));

    const card = within(driverRail()).getByRole('region', { name: 'Solicitud de ambulancia' });
    for (const label of ['Emergencia', 'Ubicación', 'Distancia', 'Solicitada']) {
      expect(within(card).getByText(label)).toBeInTheDocument();
    }
    // The mockup's "Solicitante" slot has no requester name in the domain: the
    // key names the emergency and the value carries its real id AND type.
    expect(dataRowValue(card, 'Emergencia')).toBe('EMG-002 · Traffic collision');
    expect(within(card).queryByText('Solicitante')).not.toBeInTheDocument();
    expect(dataRowValue(card, 'Ubicación')).toBe('Kennedy');
    // Without GPS the driver falls back to their own unit's declared position
    // (RAD-3), so the distance is the real, simulated one — not a missing value.
    expect(dataRowValue(card, 'Distancia')).toBe('12,8 km · 29 min');
    // Elapsed since the request was raised, from the payload's real timestamp.
    expect(dataRowValue(card, 'Solicitada')).toMatch(/^\d+:\d{2}$/);
  });

  it('shows the real emergency level as a chip in the card header', () => {
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} ambulanceId="A-07" />);
    act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));

    const heading = within(driverRail()).getByRole('heading', {
      name: 'Solicitud de ambulancia',
    });
    // The chip sits in the same header row as the h3, beside the countdown.
    expect(within(heading.parentElement as HTMLElement).getByText('High')).toBeInTheDocument();

    // A different real level must relabel the chip: the label is not hardcoded.
    cleanup();
    const critical: SolicitudBroadcastPayload = { ...BROADCAST, nivel: 'CRITICAL' };
    const criticalPort = new FakeRealtimePort();
    render(<DriverConsolePage port={criticalPort} ambulanceId="A-07" />);
    act(() => criticalPort.emit(DESTINATIONS.solicitudes, critical));

    const criticalHeading = within(driverRail()).getByRole('heading', {
      name: 'Solicitud de ambulancia',
    });
    expect(
      within(criticalHeading.parentElement as HTMLElement).getByText('Critical'),
    ).toBeInTheDocument();
  });

  it('shows "Sin clasificar" for a citizen request that declared no severity', () => {
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} ambulanceId="A-07" />);

    // A citizen request carries no `nivel`: the driver must never read an
    // invented severity like "Medium" (C1).
    const citizenRequest: SolicitudBroadcastPayload = {
      ...BROADCAST,
      zonaId: '',
      tipo: 'Solicitud de ambulancia',
    };
    delete citizenRequest.nivel;
    act(() => port.emit(DESTINATIONS.solicitudes, citizenRequest));

    const heading = within(driverRail()).getByRole('heading', {
      name: 'Solicitud de ambulancia',
    });
    expect(
      within(heading.parentElement as HTMLElement).getByText('Sin clasificar'),
    ).toBeInTheDocument();
    expect(
      within(heading.parentElement as HTMLElement).queryByText('Medium'),
    ).not.toBeInTheDocument();
    expect(within(heading.parentElement as HTMLElement).queryByText('Low')).not.toBeInTheDocument();
  });

  it('shows the reported coordinates when the request declared no zone', () => {
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} ambulanceId="A-07" />);

    const citizenRequest: SolicitudBroadcastPayload = {
      ...BROADCAST,
      zonaId: '',
      tipo: 'Solicitud de ambulancia',
      escena: { lat: 4.728, lng: -74.078 },
    };
    delete citizenRequest.nivel;
    act(() => port.emit(DESTINATIONS.solicitudes, citizenRequest));

    const card = within(driverRail()).getByRole('region', { name: 'Solicitud de ambulancia' });
    // No zone declared: the row shows the real reported coordinates, not empty.
    expect(dataRowValue(card, 'Ubicación')).toBe('4.7280, -74.0780');
  });

  it('names the other notified units and shows the real accept window', () => {
    const port = new FakeRealtimePort();
    const longWindow: SolicitudBroadcastPayload = {
      ...BROADCAST,
      timeoutEn: new Date(Date.now() + 600_000).toISOString(),
      timeoutMs: 600_000,
    };
    render(<DriverConsolePage port={port} ambulanceId="A-07" />);
    act(() => port.emit(DESTINATIONS.solicitudes, longWindow));

    const card = within(driverRail()).getByRole('region', { name: 'Solicitud de ambulancia' });
    // The own unit is never listed among the notified ones. Both units are named
    // by their plate (never the internal id): A-12 is SNK-742, the own A-07 is
    // WNR-418 and must not appear.
    const hint = within(card).getByText(/También se avisó a/);
    expect(hint).toHaveTextContent('También se avisó a SNK-742');
    expect(hint).not.toHaveTextContent('WNR-418');
    // The window is the inbox's real one (10 min here), never a hardcoded 30 s.
    expect(hint).toHaveTextContent('si no respondes en 600 s');
    expect(hint).not.toHaveTextContent('30 s');
    // The chip is the live countdown towards that same real deadline.
    expect(within(card).getByRole('timer')).toHaveTextContent(/^\d+:\d{2}$/);
  });

  it('keeps an unlisted notified unit by its id instead of dropping it', () => {
    const port = new FakeRealtimePort();
    // The fleet is empty, so AMB-XX cannot be resolved to a plate: the raw id
    // must stay visible rather than silently disappearing from the list.
    render(<DriverConsolePage port={port} ambulanceId="A-07" ambulancias={[]} />);
    act(() =>
      port.emit(DESTINATIONS.solicitudes, { ...BROADCAST, notificadas: ['A-07', 'AMB-XX'] }),
    );

    const card = within(driverRail()).getByRole('region', { name: 'Solicitud de ambulancia' });
    expect(within(card).getByText(/También se avisó a/)).toHaveTextContent(
      'También se avisó a AMB-XX',
    );
  });

  it('U4: raises an ephemeral toast with the distance, without blocking the card', async () => {
    const user = userEvent.setup();
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} ambulanceId="A-07" />);
    act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));

    // No GPS: the toast carries the distance from the unit's own declared
    // position (RAD-3), never a missing or invented value.
    const messages = () => useToastStore.getState().toasts.map((item) => item.message);
    expect(messages()).toContain('Nueva solicitud de ambulancia a 12,8 km');
    // The request card is still fully there: the toast did not replace it.
    expect(
      within(driverRail()).getByRole('heading', { name: 'Solicitud de ambulancia' }),
    ).toBeInTheDocument();

    // After simulating, a fresh arrival carries the simulated distance.
    await user.click(screen.getByRole('button', { name: 'Simular posición' }));
    act(() => port.emit(DESTINATIONS.solicitudes, { ...BROADCAST, requestId: 'REQ-2' }));

    const all = messages();
    const latest = all[all.length - 1] ?? '';
    expect(latest).toMatch(/^Nueva solicitud de ambulancia a \d+,\d km$/);
  });

  it('passes the requester pin, the connector and the notified units to the map', async () => {
    const user = userEvent.setup();
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} ambulanceId="A-07" />);
    act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));

    const map = screen.getByTestId('map-canvas');
    expect(map).toHaveAttribute('data-notified', 'A-07,A-12');
    expect(map.getAttribute('data-request-label')).toContain('Kennedy');
    // The unit fallback gives the driver an origin even without GPS, so the
    // connector is drawable straight away (RAD-3).
    expect(map).toHaveAttribute('data-connector', 'yes');

    await user.click(screen.getByRole('button', { name: 'Simular posición' }));
    expect(map).toHaveAttribute('data-connector', 'yes');
  });

  it('falls back to the own unit position without GPS and marks it simulated', async () => {
    const user = userEvent.setup();
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} ambulanceId="A-07" />);

    // No device fix: the self marker sits on A-07's declared position and the
    // map is told the position is simulated. It is named by the unit's plate.
    const map = screen.getByTestId('map-canvas');
    expect(map).toHaveAttribute('data-self-label', 'Tú · WNR-418');
    expect(map).toHaveAttribute('data-self-sim', 'yes');

    // Reported as simulated on /topic/flota once online, via the existing flag.
    await user.click(screen.getByRole('button', { name: 'Conectarse' }));
    const frame = port.published.find((entry) => entry.destination === DESTINATIONS.flota);
    expect(frame?.payload).toMatchObject({
      ambulanceId: 'A-07',
      ubicacion: { lat: 4.72, lng: -74.078 },
      source: 'simulated',
    });
  });

  it('keeps "Sin ubicación" when the driver has no unit to fall back to', () => {
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} ambulanceId="A-07" ambulancias={[]} />);
    act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));

    const map = screen.getByTestId('map-canvas');
    expect(map).toHaveAttribute('data-self-label', '');
    expect(map).toHaveAttribute('data-self-sim', 'no');
    expect(map).toHaveAttribute('data-connector', 'no');

    const card = within(driverRail()).getByRole('region', { name: 'Solicitud de ambulancia' });
    expect(dataRowValue(card, 'Distancia')).toBe('Sin ubicación');
  });

  it('mirrors the pending request in the shell bell count', () => {
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} ambulanceId="A-07" />);

    expect(useDriverAlertsStore.getState().pendingRequests).toBe(0);
    act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));
    expect(useDriverAlertsStore.getState().pendingRequests).toBe(1);
  });

  it('shows submitting after accept and Taken by another unit in the card', async () => {
    const user = userEvent.setup();
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} ambulanceId="A-07" />);

    act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Difundida a varias unidades. Gana quien acepte primero.',
    );

    await user.click(screen.getByRole('button', { name: 'Aceptar solicitud' }));
    expect(screen.getByRole('status')).toHaveTextContent('Enviando…');
    expect(screen.queryByText('Misión actual')).not.toBeInTheDocument();

    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        type: 'request.taken',
        requestId: 'REQ-1',
        winner: 'A-09',
      }),
    );

    expect(screen.getByRole('status')).toHaveTextContent('Tomada por A-09');
    expect(screen.queryByText('Misión actual')).not.toBeInTheDocument();
  });

  it('shows the mission card when the arbiter assigns this driver', async () => {
    const user = userEvent.setup();
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} ambulanceId="A-07" />);

    act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));
    await user.click(screen.getByRole('button', { name: 'Aceptar solicitud' }));
    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        type: 'request.taken',
        requestId: 'REQ-1',
        winner: 'A-07',
      }),
    );

    expect(screen.getByRole('status')).toHaveTextContent('Te la asignaron');
    expect(screen.getByText('Misión actual')).toBeInTheDocument();
  });

  it('advances to the d4 "En camino al ciudadano" rail when this driver wins', async () => {
    const user = userEvent.setup();
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} ambulanceId="A-07" />);

    act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));
    await user.click(screen.getByRole('button', { name: 'Aceptar solicitud' }));
    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        type: 'request.taken',
        requestId: 'REQ-1',
        winner: 'A-07',
      }),
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'En camino al ciudadano' }),
    ).toBeInTheDocument();
    // The request card is gone: an occupied unit is not looking for work.
    expect(
      within(driverRail()).queryByRole('heading', { name: 'Solicitud de ambulancia' }),
    ).not.toBeInTheDocument();

    const rail = driverRail();
    expect(within(rail).getByText('Solicitud aceptada')).toBeInTheDocument();
    // The unit is genuinely occupied: the chip says so, not the declared status.
    expect(driverStatusChip()).toHaveTextContent('Ocupada');
    // The won request is no longer pending, so the shell bell drops to zero.
    expect(useDriverAlertsStore.getState().pendingRequests).toBe(0);

    const steps = within(rail).getByRole('list', { name: 'Progreso de la misión' });
    const stepItems = within(steps).getAllByRole('listitem');
    expect(stepItems.map((item) => item.textContent)).toEqual([
      'Aceptada',
      'En camino',
      'Llegada',
      'Finalizada',
    ]);
    expect(stepItems[1]).toHaveAttribute('aria-current', 'step');
    expect(stepItems[0]).not.toHaveAttribute('aria-current');

    // The big ETA and the real distance · location come from the payload scene.
    expect(within(rail).getByText('12,8 km · Kennedy')).toBeInTheDocument();
    expect(within(rail).getByText(/^\d+ min$/)).toBeInTheDocument();
    expect(
      within(rail).getByText(/Mientras estés ocupada no recibirás nuevas solicitudes/),
    ).toBeInTheDocument();

    // The mission's identity is preserved: type and declared severity.
    expect(within(rail).getByText('Misión actual')).toBeInTheDocument();
    expect(within(rail).getByText('Traffic collision')).toBeInTheDocument();
    expect(within(rail).getByText('High')).toBeInTheDocument();
  });

  it('enables "Declarar llegada" in d4, publishes it, and advances to d5 on the echo', async () => {
    const user = userEvent.setup();
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} ambulanceId="A-07" />);
    await winMission(user, port);

    const declare = within(driverRail()).getByRole('button', { name: 'Declarar llegada' });
    expect(declare).toBeEnabled();
    // The other action still has no contact data, so it stays disabled with reason.
    const call = within(driverRail()).getByRole('button', { name: 'Llamar al solicitante' });
    expect(call).toBeDisabled();
    expect(call).toHaveAttribute('title', 'Aún no hay un número de contacto del solicitante.');

    await user.click(declare);

    expect(port.published[port.published.length - 1]?.payload).toEqual({
      type: 'solicitud.llegada',
      requestId: 'REQ-1',
      ambulanceId: 'A-07',
    });
    // Still d4: the client waits for the relay to echo the arrival.
    expect(
      screen.getByRole('heading', { level: 1, name: 'En camino al ciudadano' }),
    ).toBeInTheDocument();

    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        type: 'request.arrived',
        requestId: 'REQ-1',
        ambulanceId: 'A-07',
      }),
    );

    // d5: the title, the step-4 stepper, the real timeline and the final action.
    expect(
      screen.getByRole('heading', { level: 1, name: 'Llegaste al destino' }),
    ).toBeInTheDocument();
    const rail = driverRail();
    const steps = within(rail).getByRole('list', { name: 'Progreso de la misión' });
    const stepItems = within(steps).getAllByRole('listitem');
    expect(stepItems.map((item) => item.textContent)).toEqual([
      'Aceptada',
      'En camino',
      'Llegada',
      'Finalizada',
    ]);
    // On arrival the driver has NOT finished the service: the active step is
    // "Llegada" (index 2), never the mockup's literal "Finalizada" (index 3).
    expect(stepItems[2]).toHaveAttribute('aria-current', 'step');
    expect(stepItems[3]).not.toHaveAttribute('aria-current');
    expect(stepItems[3]).toHaveTextContent('Finalizada');
    expect(stepItems[3].querySelector('svg')).toBeNull();

    const timeline = within(rail).getByRole('list', { name: 'Línea de tiempo de la misión' });
    const entries = within(timeline).getAllByRole('listitem');
    // Two real entries until the citizen confirms; every time is a real H:MM.
    expect(entries).toHaveLength(2);
    expect(entries[0].textContent).toMatch(/^Aceptaste la solicitud\d{1,2}:\d{2}$/);
    expect(entries[1].textContent).toMatch(/^Declaraste la llegada\d{1,2}:\d{2}$/);
    expect(
      within(rail).queryByRole('button', { name: 'Declarar llegada' }),
    ).not.toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: 'Finalizar servicio' })).toBeEnabled();
    expect(
      within(rail).getByText(/vuelve a quedar disponible para nuevas solicitudes/),
    ).toBeInTheDocument();
  });

  it('shows the confirmation toast and the third timeline entry only after request.confirmed', async () => {
    const user = userEvent.setup();
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} ambulanceId="A-07" />);
    await winMission(user, port);
    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        type: 'request.arrived',
        requestId: 'REQ-1',
        ambulanceId: 'A-07',
      }),
    );

    // Not yet: the toast never announces a step that has not happened.
    expect(screen.queryByText('El ciudadano confirmó que llegaste')).not.toBeInTheDocument();

    act(() =>
      port.emit(DESTINATIONS.solicitudes, { type: 'request.confirmed', requestId: 'REQ-1' }),
    );

    expect(screen.getByText('El ciudadano confirmó que llegaste')).toBeInTheDocument();
    const timeline = within(driverRail()).getByRole('list', {
      name: 'Línea de tiempo de la misión',
    });
    let entries = within(timeline).getAllByRole('listitem');
    expect(entries).toHaveLength(3);
    expect(entries[2].textContent).toMatch(/^El ciudadano confirmó la llegada\d{1,2}:\d{2}$/);

    // Idempotent: a repeated confirmation does not duplicate the entry or the toast.
    act(() =>
      port.emit(DESTINATIONS.solicitudes, { type: 'request.confirmed', requestId: 'REQ-1' }),
    );
    entries = within(timeline).getAllByRole('listitem');
    expect(entries).toHaveLength(3);
    expect(screen.getAllByText('El ciudadano confirmó que llegaste')).toHaveLength(1);
  });

  it('returns the unit to available and the driver to the map on "Finalizar servicio"', async () => {
    const user = userEvent.setup();
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} ambulanceId="A-07" />);
    await user.click(screen.getByRole('button', { name: 'Conectarse' }));
    await winMission(user, port);
    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        type: 'request.arrived',
        requestId: 'REQ-1',
        ambulanceId: 'A-07',
      }),
    );

    await user.click(within(driverRail()).getByRole('button', { name: 'Finalizar servicio' }));

    expect(
      screen.getByRole('heading', { level: 1, name: 'Mapa de operación' }),
    ).toBeInTheDocument();
    expect(driverStatusChip()).toHaveTextContent('Disponible');
    expect(
      within(driverRail()).queryByRole('button', { name: 'Finalizar servicio' }),
    ).not.toBeInTheDocument();
    // The mission panel is gone: the rail is back to the operations view.
    expect(
      within(driverRail()).queryByRole('list', { name: 'Progreso de la misión' }),
    ).not.toBeInTheDocument();

    // The unit is republished as AVAILABLE on /topic/flota: it is free again.
    const flota = port.published.filter((frame) => frame.destination === DESTINATIONS.flota);
    expect(flota[flota.length - 1]?.payload).toMatchObject({
      ambulanceId: 'A-07',
      estado: 'AVAILABLE',
    });
  });

  it('draws the mission connector solid and keeps the requester marker on the map', async () => {
    const user = userEvent.setup();
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} ambulanceId="A-07" />);

    act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));
    // Dashed while the request is still pending (`d3`).
    expect(screen.getByTestId('map-canvas')).toHaveAttribute('data-connector-dashed', 'yes');

    await user.click(screen.getByRole('button', { name: 'Aceptar solicitud' }));
    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        type: 'request.taken',
        requestId: 'REQ-1',
        winner: 'A-07',
      }),
    );

    const map = screen.getByTestId('map-canvas');
    expect(map).toHaveAttribute('data-connector', 'yes');
    // Solid on the live mission (`C.d4`), and the requester pin keeps its label.
    expect(map).toHaveAttribute('data-connector-dashed', 'no');
    expect(map.getAttribute('data-request-label')).toContain('Kennedy');
    expect(map).toHaveAttribute('data-notified', '');
  });

  it('draws the real route and shows its REAL duration when one resolves', async () => {
    const port = new FakeRealtimePort();
    mockFetchRuta.mockResolvedValue({
      geometria: [
        [4.72, -74.078],
        [4.68, -74.11],
        [4.628, -74.148],
      ],
      distanciaKm: 14.2,
      duracionMin: 7.44,
    });
    render(<DriverConsolePage port={port} ambulanceId="A-07" />);
    act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));

    // The route geometry reaches the map, which hides the straight connector.
    await waitFor(() =>
      expect(screen.getByTestId('map-canvas')).toHaveAttribute('data-ruta', 'yes'),
    );
    expect(screen.getByTestId('map-canvas')).toHaveAttribute('data-ruta-points', '3');

    // 7.44 min from OSRM wins over the ~29 min straight-line estimate.
    const card = within(driverRail()).getByRole('region', { name: 'Solicitud de ambulancia' });
    expect(dataRowValue(card, 'Distancia')).toBe('12,8 km · 7 min');
  });

  it('keeps the straight-line ETA and no route when routing is unavailable', () => {
    const port = new FakeRealtimePort();
    // The default routing mock never settles: the honest fallback stays.
    render(<DriverConsolePage port={port} ambulanceId="A-07" />);
    act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));

    const map = screen.getByTestId('map-canvas');
    expect(map).toHaveAttribute('data-ruta', 'no');
    expect(map).toHaveAttribute('data-ruta-points', '0');

    const card = within(driverRail()).getByRole('region', { name: 'Solicitud de ambulancia' });
    expect(dataRowValue(card, 'Distancia')).toBe('12,8 km · 29 min');
  });

  it('U5: lists every request from the real registry, never just one', () => {
    render(<DriverConsolePage port={new FakeRealtimePort()} ambulanceId="A-07" />);

    const rail = driverRail();
    expect(within(rail).getByText('Todas las solicitudes')).toBeInTheDocument();
    const list = within(rail).getByRole('list', { name: 'Lista de solicitudes' });
    // The count comes from the fixtures' real registry, not a fixed one.
    expect(within(list).getAllByRole('listitem')).toHaveLength(MOCK_SOLICITUDES.length);
    // Every row is a real request id from the registry, not a placeholder.
    expect(within(list).getAllByText(/^REQ-\d+$/)).toHaveLength(MOCK_SOLICITUDES.length);
  });

  it('U6: a tapped request opens the sliding sheet with the three actions', async () => {
    const user = userEvent.setup();
    render(<DriverConsolePage port={new FakeRealtimePort()} ambulanceId="A-07" />);

    const list = within(driverRail()).getByRole('list', { name: 'Lista de solicitudes' });
    const row = within(list).getByText(MOCK_SOLICITUDES[0].id).closest('button');
    expect(row).not.toBeNull();
    await user.click(row as HTMLElement);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Aceptar' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Rechazar' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Visualizar' })).toBeInTheDocument();
  });

  it('U6: "Aceptar" in the sheet reuses the inbox accept and bids for the open request', async () => {
    const user = userEvent.setup();
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} ambulanceId="A-07" />);

    // Make REQ-1 the inbox's open broadcast, then open its row in the sheet.
    act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));
    const list = within(driverRail()).getByRole('list', { name: 'Lista de solicitudes' });
    await user.click(within(list).getByText('REQ-1').closest('button') as HTMLElement);

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Aceptar' }));

    expect(port.published[0]?.payload).toEqual({
      type: 'solicitud.accept',
      requestId: 'REQ-1',
      ambulanceId: 'A-07',
    });
  });

  it('U7: "Visualizar" closes the sheet and focuses the map on the requester', async () => {
    const user = userEvent.setup();
    const port = new FakeRealtimePort();
    render(
      <DriverConsolePage port={port} ambulanceId="A-07" solicitudes={[MOCK_SOLICITUDES[0]]} />,
    );

    // Open REQ-1001 (its emergency EMG-002 sits at the fixture position 4.628/-74.148).
    const list = within(driverRail()).getByRole('list', { name: 'Lista de solicitudes' });
    await user.click(within(list).getByText('REQ-1001').closest('button') as HTMLElement);
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: 'Visualizar' }));

    // The sheet is gone and the map was handed the requester's real coordinates.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const map = screen.getByTestId('map-canvas');
    expect(Number(map.getAttribute('data-focus-lat'))).toBeCloseTo(4.628, 3);
    expect(Number(map.getAttribute('data-focus-lng'))).toBeCloseTo(-74.148, 3);
  });

  it('MAP-3: clicking a solicitud row centres the map on its location', async () => {
    const user = userEvent.setup();
    const port = new FakeRealtimePort();
    render(
      <DriverConsolePage port={port} ambulanceId="A-07" solicitudes={[MOCK_SOLICITUDES[0]]} />,
    );

    // REQ-1001 points at EMG-002 (fixture 4.628 / -74.148). The ROW click alone —
    // no "Visualizar" — must move the viewport there.
    const list = within(driverRail()).getByRole('list', { name: 'Lista de solicitudes' });
    await user.click(within(list).getByText('REQ-1001').closest('button') as HTMLElement);

    const map = screen.getByTestId('map-canvas');
    await waitFor(() => expect(Number(map.getAttribute('data-focus-lat'))).toBeCloseTo(4.628, 3));
    expect(Number(map.getAttribute('data-focus-lng'))).toBeCloseTo(-74.148, 3);
  });

  it('MAP-3: a solicitud with no resolvable location does not move the map', async () => {
    const user = userEvent.setup();
    const port = new FakeRealtimePort();
    // No emergency, no aid center, no zone and no pickup point: nothing resolves.
    const orphan: SolicitudAmbulancia = {
      ...MOCK_SOLICITUDES[0],
      id: 'REQ-ORPHAN',
      emergenciaId: '',
      centroAyudaId: '',
      zonaId: '',
    };
    render(<DriverConsolePage port={port} ambulanceId="A-07" solicitudes={[orphan]} />);

    const map = screen.getByTestId('map-canvas');
    // The one-shot first centering is already consumed: no focus is pending.
    await waitFor(() => expect(map).toHaveAttribute('data-focus-lat', ''));

    const list = within(driverRail()).getByRole('list', { name: 'Lista de solicitudes' });
    await user.click(within(list).getByText('REQ-ORPHAN').closest('button') as HTMLElement);

    // Still no focus: the map was not sent to an invented point.
    expect(map).toHaveAttribute('data-focus-lat', '');
    expect(map).toHaveAttribute('data-focus-lng', '');
  });

  it('MAP-4: the selected solicitud drives the pin and the route, and clearing restores the active scene', async () => {
    const user = userEvent.setup();
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} ambulanceId="A-07" />);

    // Active broadcast REQ-1 at 4.628 / -74.148: the pin and the route point there.
    act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));
    const map = screen.getByTestId('map-canvas');
    await waitFor(() => expect(map).toHaveAttribute('data-request-lat', '4.628'));
    expect(map).toHaveAttribute('data-request-lng', '-74.148');

    // Select REQ-1002 (EMG-001 at 4.598 / -74.075): pin and route follow it.
    const list = within(driverRail()).getByRole('list', { name: 'Lista de solicitudes' });
    await user.click(within(list).getByText('REQ-1002').closest('button') as HTMLElement);
    await waitFor(() => expect(map).toHaveAttribute('data-request-lat', '4.598'));
    expect(map).toHaveAttribute('data-request-lng', '-74.075');
    const route = mockFetchRuta.mock.calls[mockFetchRuta.mock.calls.length - 1];
    expect(route?.[1]).toEqual({ lat: 4.598, lng: -74.075 });

    // Closing the sheet clears the selection: the map returns to the active scene.
    await user.click(screen.getByRole('button', { name: 'Cerrar' }));
    await waitFor(() => expect(map).toHaveAttribute('data-request-lat', '4.628'));
    expect(map).toHaveAttribute('data-request-lng', '-74.148');
  });

  it('rejects from the card and keeps the rejection feedback', async () => {
    const user = userEvent.setup();
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} ambulanceId="A-07" />);

    act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));
    await user.click(screen.getByRole('button', { name: 'Rechazar' }));

    expect(port.published[0]?.payload).toEqual({
      type: 'solicitud.reject',
      requestId: 'REQ-1',
      ambulanceId: 'A-07',
    });
    expect(screen.getByRole('status')).toHaveTextContent('Solicitud rechazada');
  });

  it('keeps the fixtures as the source in demo mode and never reads the backend', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<DriverConsolePage port={new FakeRealtimePort()} ambulanceId="A-07" />);

    // Every store is hydrated from the fixtures, exactly as before the fix.
    expect(useFleetStore.getState().units.map((unit) => unit.id)).toContain('A-07');
    expect(useEmergencyStore.getState().items.map((item) => item.id)).toContain('EMG-002');
    expect(useSolicitudesStore.getState().items.map((item) => item.id)).toContain('REQ-1001');
    // And no source fell through to the backend.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
