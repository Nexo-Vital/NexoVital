import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DESTINATIONS,
  type SolicitudBroadcastPayload,
  type SolicitudDirectPayload,
} from '@/shared/realtime';
import { FakeRealtimePort } from '@/test/fake-realtime-port';
import { useSolicitudInbox } from './use-solicitud-inbox';

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

const DIRECT: SolicitudDirectPayload = {
  ...BROADCAST,
  type: 'solicitud.direct',
  mode: 'direct',
  targetAmbulanceId: 'AMB-03',
  notificadas: ['AMB-03'],
  notifiedCount: 1,
  timeoutMs: 45_000,
};

function setup() {
  const port = new FakeRealtimePort();
  const view = renderHook(() => useSolicitudInbox(port, 'AMB-01', { lat: 4.6, lng: -74.1 }));
  return { port, ...view };
}

describe('useSolicitudInbox', () => {
  afterEach(cleanup);

  it('treats accept as a bid and waits for the arbiter', () => {
    const { port, result } = setup();

    act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));
    expect(result.current.broadcast?.requestId).toBe('REQ-1');

    act(() => result.current.accept());

    expect(result.current.phase).toBe('submitting');
    expect(result.current.outcomeMessage).toBe('Submitting…');
    expect(result.current.mission).toBeNull();
    expect(port.published).toEqual([
      {
        destination: DESTINATIONS.solicitudes,
        payload: { type: 'solicitud.accept', requestId: 'REQ-1', ambulanceId: 'AMB-01' },
      },
    ]);
  });

  it('creates the mission only when the driver is the winner', () => {
    const { port, result } = setup();

    act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));
    act(() => result.current.accept());
    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        type: 'request.taken',
        requestId: 'REQ-1',
        winner: 'AMB-01',
      }),
    );

    expect(result.current.phase).toBe('assigned');
    expect(result.current.outcomeMessage).toBe('Assigned to you');
    expect(result.current.mission?.requestId).toBe('REQ-1');
    expect(result.current.mission?.etaMinutes).toBeGreaterThan(0);
  });

  it('keeps the win when a later accept is broadcast as already-taken', () => {
    const { port, result } = setup();

    act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));
    act(() => result.current.accept());
    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        type: 'request.taken',
        requestId: 'REQ-1',
        winner: 'AMB-01',
      }),
    );
    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        type: 'request.already-taken',
        requestId: 'REQ-1',
        winner: 'AMB-01',
        rejected: 'AMB-09',
      }),
    );

    expect(result.current.phase).toBe('assigned');
    expect(result.current.outcomeMessage).toBe('Assigned to you');
    expect(result.current.mission?.requestId).toBe('REQ-1');
  });

  it('shows who took the request when another unit wins', () => {
    const { port, result } = setup();

    act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));
    act(() => result.current.accept());
    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        type: 'request.taken',
        requestId: 'REQ-1',
        winner: 'AMB-09',
      }),
    );

    expect(result.current.phase).toBe('taken');
    expect(result.current.outcomeMessage).toBe('Taken by AMB-09');
    expect(result.current.mission).toBeNull();
  });

  it('shows who took the request when a later accept is rejected', () => {
    const { port, result } = setup();

    act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));
    act(() => result.current.accept());
    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        type: 'request.already-taken',
        requestId: 'REQ-1',
        winner: 'AMB-09',
        rejected: 'AMB-01',
      }),
    );

    expect(result.current.phase).toBe('taken');
    expect(result.current.outcomeMessage).toBe('Taken by AMB-09');
  });

  it('publishes a reject and clears the overlay', () => {
    const { port, result } = setup();

    act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));
    act(() => result.current.reject());

    expect(result.current.phase).toBe('rejected');
    expect(port.published[0]?.payload).toEqual({
      type: 'solicitud.reject',
      requestId: 'REQ-1',
      ambulanceId: 'AMB-01',
    });
  });

  it('marks the request as timed out when the countdown expires', () => {
    const { port, result } = setup();

    act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));
    act(() => result.current.notifyTimeout());

    expect(result.current.phase).toBe('timeout');
    expect(result.current.outcomeMessage).toBe('Request timed out');
  });

  it('accepts a direct request addressed to this unit', () => {
    const { port, result } = setup();

    act(() => port.emit(DESTINATIONS.solicitudes, { ...DIRECT, targetAmbulanceId: 'AMB-01' }));

    expect(result.current.broadcast?.requestId).toBe('REQ-1');
    expect(result.current.broadcast?.mode).toBe('direct');
  });

  it('ignores and never bids on a direct request addressed to another unit', () => {
    const { port, result } = setup();

    act(() => port.emit(DESTINATIONS.solicitudes, DIRECT));

    expect(result.current.broadcast).toBeNull();

    act(() => result.current.accept());
    expect(port.published).toHaveLength(0);
  });

  it('reports an arbiter rejection for this unit', () => {
    const { port, result } = setup();

    act(() => port.emit(DESTINATIONS.solicitudes, { ...DIRECT, targetAmbulanceId: 'AMB-01' }));
    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        type: 'request.rejected',
        requestId: 'REQ-1',
        rejected: 'AMB-01',
        reason: 'not-targeted',
      }),
    );

    expect(result.current.phase).toBe('rejected');
    expect(result.current.outcomeMessage).toBe('Rejected: not the targeted unit');
  });
});
