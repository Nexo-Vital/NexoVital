import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DESTINATIONS, type SolicitudBroadcastPayload } from '@/shared/realtime';
import { FakeRealtimePort } from '@/test/fake-realtime-port';
import DriverConsolePage from './DriverConsolePage';

// Leaflet needs a real layout engine; stub the map so the driver sheet and the
// request overlay are tested in isolation.
vi.mock('@/features/mapa/MapCanvas', () => ({
  MapCanvas: () => <div data-testid="map-canvas" />,
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
  notificadas: ['AMB-01', 'AMB-03'],
};

describe('DriverConsolePage', () => {
  afterEach(cleanup);

  it('renders the map, the bottom sheet and the go-online action', () => {
    render(<DriverConsolePage port={new FakeRealtimePort()} ambulanceId="AMB-01" />);

    expect(screen.getByTestId('map-canvas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /go online/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /simulate my position/i })).toBeInTheDocument();
  });

  it('shows submitting after accept and Taken by another unit', async () => {
    const user = userEvent.setup();
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} ambulanceId="AMB-01" />);

    act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));
    expect(screen.getByText('Broadcast request')).toBeInTheDocument();
    expect(screen.getByText('Traffic collision')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Accept' }));
    expect(screen.getByRole('status')).toHaveTextContent('Submitting…');
    expect(screen.queryByText('Current mission')).not.toBeInTheDocument();

    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        type: 'request.taken',
        requestId: 'REQ-1',
        winner: 'AMB-09',
      }),
    );

    expect(screen.getByRole('status')).toHaveTextContent('Taken by AMB-09');
    expect(screen.queryByText('Current mission')).not.toBeInTheDocument();
  });

  it('shows the mission card when the arbiter assigns this driver', async () => {
    const user = userEvent.setup();
    const port = new FakeRealtimePort();
    render(<DriverConsolePage port={port} ambulanceId="AMB-01" />);

    act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        type: 'request.taken',
        requestId: 'REQ-1',
        winner: 'AMB-01',
      }),
    );

    expect(screen.getByRole('status')).toHaveTextContent('Assigned to you');
    expect(screen.getByText('Current mission')).toBeInTheDocument();
  });
});
