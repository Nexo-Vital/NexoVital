import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDriverAlertsStore } from '@/features/conductor/driver-alerts-store';
import { MOCK_CENTROS_AYUDA } from '@/mocks/fixtures';
import { DESTINATIONS, type SolicitudBroadcastPayload } from '@/shared/realtime';
import { FakeRealtimePort } from '@/test/fake-realtime-port';
import DriverConsolePage from './DriverConsolePage';

// Leaflet needs a real layout engine; stub the map so the driver unit panel, the
// rail and the request card are tested in isolation. The stub echoes the props
// this unit wires (aid centers, the self label, the requester pin, the connector
// and the notified units) so the page's data path stays asserted without a map.
vi.mock('@/features/mapa/MapCanvas', () => ({
  MapCanvas: (props: {
    centros?: unknown[];
    self?: { label?: string } | null;
    request?: { label?: string } | null;
    requestConnector?: unknown;
    notifiedAmbulanceIds?: readonly string[];
  }) => (
    <div
      data-testid="map-canvas"
      data-centers={props.centros?.length ?? 0}
      data-self-label={props.self?.label ?? ''}
      data-request-label={props.request?.label ?? ''}
      data-connector={props.requestConnector ? 'yes' : 'no'}
      data-notified={(props.notifiedAmbulanceIds ?? []).join(',')}
    />
  ),
}));

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
  notificadas: ['AMB-01', 'AMB-03'],
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

/** Replaces the geolocation stub; `undefined` restores the "unsupported" state. */
function setGeolocation(value: unknown): void {
  Object.defineProperty(window.navigator, 'geolocation', { value, configurable: true });
}

describe('DriverConsolePage', () => {
  afterEach(() => {
    cleanup();
    useDriverAlertsStore.setState({ pendingRequests: 0 });
    setGeolocation(undefined);
  });

  it('renders the map and the unit panel controls', () => {
    render(<DriverConsolePage port={new FakeRealtimePort()} ambulanceId="AMB-01" />);

    expect(screen.getByTestId('map-canvas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Conectarse' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Simular posición' })).toBeInTheDocument();
  });

  it('no longer renders the driver bottom sheet', () => {
    render(<DriverConsolePage port={new FakeRealtimePort()} ambulanceId="AMB-01" />);

    // The sheet was a region labelled "Driver controls" with English copy.
    expect(screen.queryByRole('region', { name: 'Driver controls' })).not.toBeInTheDocument();
    expect(screen.queryByText('Driver console')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /go online/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /simulate my position/i })).not.toBeInTheDocument();
  });

  it('toggles the driver connection in Spanish and marks it in the panel', async () => {
    const user = userEvent.setup();
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} ambulanceId="AMB-01" />);

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
    render(<DriverConsolePage port={new FakeRealtimePort()} ambulanceId="AMB-01" />);

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

    render(<DriverConsolePage port={new FakeRealtimePort()} ambulanceId="AMB-01" />);

    expect(screen.getByText(/Permiso de ubicación denegado/)).toBeInTheDocument();
  });

  it('renders the header, the summary chips and the three rail panels', () => {
    render(<DriverConsolePage port={new FakeRealtimePort()} ambulanceId="AMB-01" />);

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

  it('shows the own unit id and plate, and its chip tracks the driver status', async () => {
    const user = userEvent.setup();
    render(<DriverConsolePage port={new FakeRealtimePort()} ambulanceId="AMB-01" />);

    const rail = driverRail();
    expect(within(rail).getByText('AMB-01 · OVX-101')).toBeInTheDocument();
    expect(within(rail).getByText('Chapinero')).toBeInTheDocument();
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
    render(<DriverConsolePage port={new FakeRealtimePort()} ambulanceId="AMB-01" />);

    expect(screen.getByTestId('map-canvas')).toHaveAttribute(
      'data-centers',
      String(MOCK_CENTROS_AYUDA.length),
    );

    await user.click(screen.getByRole('button', { name: 'Simular posición' }));
    expect(screen.getByTestId('map-canvas')).toHaveAttribute('data-self-label', 'Tú · AMB-01');
  });

  it('stops claiming there are no requests and renders the request card', () => {
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} ambulanceId="AMB-01" />);

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
    render(<DriverConsolePage port={port} ambulanceId="AMB-01" />);
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
    // Without a device position the distance is honestly unknown.
    expect(dataRowValue(card, 'Distancia')).toBe('Sin ubicación');
    // Elapsed since the request was raised, from the payload's real timestamp.
    expect(dataRowValue(card, 'Solicitada')).toMatch(/^\d+:\d{2}$/);
  });

  it('shows the real emergency level as a chip in the card header', () => {
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} ambulanceId="AMB-01" />);
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
    render(<DriverConsolePage port={criticalPort} ambulanceId="AMB-01" />);
    act(() => criticalPort.emit(DESTINATIONS.solicitudes, critical));

    const criticalHeading = within(driverRail()).getByRole('heading', {
      name: 'Solicitud de ambulancia',
    });
    expect(
      within(criticalHeading.parentElement as HTMLElement).getByText('Critical'),
    ).toBeInTheDocument();
  });

  it('names the other notified units and shows the real accept window', () => {
    const port = new FakeRealtimePort();
    const longWindow: SolicitudBroadcastPayload = {
      ...BROADCAST,
      timeoutEn: new Date(Date.now() + 600_000).toISOString(),
      timeoutMs: 600_000,
    };
    render(<DriverConsolePage port={port} ambulanceId="AMB-01" />);
    act(() => port.emit(DESTINATIONS.solicitudes, longWindow));

    const card = within(driverRail()).getByRole('region', { name: 'Solicitud de ambulancia' });
    // The own unit is never listed among the notified ones.
    const hint = within(card).getByText(/También se avisó a/);
    expect(hint).toHaveTextContent('También se avisó a AMB-03');
    expect(hint).not.toHaveTextContent('AMB-01');
    // The window is the inbox's real one (10 min here), never a hardcoded 30 s.
    expect(hint).toHaveTextContent('si no respondes en 600 s');
    expect(hint).not.toHaveTextContent('30 s');
    // The chip is the live countdown towards that same real deadline.
    expect(within(card).getByRole('timer')).toHaveTextContent(/^\d+:\d{2}$/);
  });

  it('shows the toast with the real distance once the driver position is known', async () => {
    const user = userEvent.setup();
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} ambulanceId="AMB-01" />);
    act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));

    // No position yet: the toast still announces the request, without a distance.
    expect(screen.getByText('Nueva solicitud de ambulancia')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Simular posición' }));

    expect(screen.getByText(/Nueva solicitud de ambulancia/)).toHaveTextContent(/a \d+,\d km$/);
  });

  it('passes the requester pin, the connector and the notified units to the map', async () => {
    const user = userEvent.setup();
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} ambulanceId="AMB-01" />);
    act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));

    const map = screen.getByTestId('map-canvas');
    expect(map).toHaveAttribute('data-notified', 'AMB-01,AMB-03');
    expect(map.getAttribute('data-request-label')).toContain('Kennedy');
    expect(map).toHaveAttribute('data-connector', 'no');

    await user.click(screen.getByRole('button', { name: 'Simular posición' }));
    expect(map).toHaveAttribute('data-connector', 'yes');
  });

  it('mirrors the pending request in the shell bell count', () => {
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} ambulanceId="AMB-01" />);

    expect(useDriverAlertsStore.getState().pendingRequests).toBe(0);
    act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));
    expect(useDriverAlertsStore.getState().pendingRequests).toBe(1);
  });

  it('shows submitting after accept and Taken by another unit in the card', async () => {
    const user = userEvent.setup();
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} ambulanceId="AMB-01" />);

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
        winner: 'AMB-09',
      }),
    );

    expect(screen.getByRole('status')).toHaveTextContent('Tomada por AMB-09');
    expect(screen.queryByText('Misión actual')).not.toBeInTheDocument();
  });

  it('shows the mission card when the arbiter assigns this driver', async () => {
    const user = userEvent.setup();
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} ambulanceId="AMB-01" />);

    act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));
    await user.click(screen.getByRole('button', { name: 'Aceptar solicitud' }));
    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        type: 'request.taken',
        requestId: 'REQ-1',
        winner: 'AMB-01',
      }),
    );

    expect(screen.getByRole('status')).toHaveTextContent('Te la asignaron');
    expect(screen.getByText('Misión actual')).toBeInTheDocument();
  });

  it('rejects from the card and keeps the rejection feedback', async () => {
    const user = userEvent.setup();
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} ambulanceId="AMB-01" />);

    act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));
    await user.click(screen.getByRole('button', { name: 'Rechazar' }));

    expect(port.published[0]?.payload).toEqual({
      type: 'solicitud.reject',
      requestId: 'REQ-1',
      ambulanceId: 'AMB-01',
    });
    expect(screen.getByRole('status')).toHaveTextContent('Solicitud rechazada');
  });
});
