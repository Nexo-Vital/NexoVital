import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useToastStore } from '@/components/ui/toast';
import { useEmergencyStore } from '@/features/emergencias/emergency-store';
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
  nivel: 'HIGH',
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
  afterEach(() => {
    cleanup();
    // Both stores live at module scope: clear them so no case leaks into another.
    useToastStore.setState({ toasts: [] });
    useEmergencyStore.setState({ items: [] });
  });

  it('treats accept as a bid and waits for the arbiter', () => {
    const { port, result } = setup();

    act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));
    expect(result.current.broadcast?.requestId).toBe('REQ-1');

    act(() => result.current.accept());

    expect(result.current.phase).toBe('submitting');
    expect(result.current.outcomeMessage).toBe('Enviando…');
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
    expect(result.current.outcomeMessage).toBe('Te la asignaron');
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
    expect(result.current.outcomeMessage).toBe('Te la asignaron');
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
    expect(result.current.outcomeMessage).toBe('Tomada por AMB-09');
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
    expect(result.current.outcomeMessage).toBe('Tomada por AMB-09');
  });

  it('publishes a reject and clears the request', () => {
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
    expect(result.current.outcomeMessage).toBe('La solicitud expiró');
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
    expect(result.current.outcomeMessage).toBe('Rechazada: no era la unidad destinataria');
  });

  it('ignores a broadcast that did not notify this unit', () => {
    const { port, result } = setup();

    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        ...BROADCAST,
        notificadas: ['AMB-02', 'AMB-03'],
      }),
    );

    expect(result.current.broadcast).toBeNull();

    act(() => result.current.accept());
    act(() => result.current.reject());
    expect(port.published).toHaveLength(0);
  });

  it('drops the open request from the inbox when it is cancelled', () => {
    const { port, result } = setup();

    act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));
    expect(result.current.broadcast?.requestId).toBe('REQ-1');

    act(() =>
      port.emit(DESTINATIONS.solicitudes, { type: 'request.cancelled', requestId: 'REQ-1' }),
    );

    expect(result.current.broadcast).toBeNull();
    expect(result.current.deadlineMs).toBeNull();
    expect(result.current.phase).toBe('idle');
  });

  it('raises an ephemeral toast at the exact arrival point', () => {
    const { port, result } = setup();

    expect(useToastStore.getState().toasts).toHaveLength(0);
    act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));

    // U4: the request became active, so a toast was raised at that instant.
    const toastMessages = () => useToastStore.getState().toasts.map((item) => item.message);
    expect(toastMessages()).toHaveLength(1);
    expect(toastMessages()[0]).toContain('Nueva solicitud de ambulancia');
    // The inbox is untouched: the toast never blocks or replaces the request.
    expect(result.current.broadcast?.requestId).toBe('REQ-1');
  });

  it('U8: validates a backend wire frame and opens the request', () => {
    const { port, result } = setup();

    // The emergency is known, so the scene/type/level are resolved from it; the
    // wire itself carries none of them.
    useEmergencyStore.setState({
      items: [
        {
          id: 'EMG-002',
          ubicacion: { lat: 4.628, lng: -74.148 },
          nivel: 'HIGH',
          estado: 'REPORTED',
          descripcion: 'Traffic collision',
          zonaId: 'Kennedy',
          createdAt: new Date().toISOString(),
        },
      ],
    });

    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        solicitudId: 'REQ-1',
        emergenciaId: 'EMG-002',
        zonaId: 'Kennedy',
        estado: 'PENDIENTE',
        ambulanciasNotificadas: ['AMB-01'],
        ambulanciaAsignadaId: null,
      }),
    );

    expect(result.current.broadcast?.requestId).toBe('REQ-1');
    expect(result.current.broadcast?.tipo).toBe('Traffic collision');
    expect(result.current.broadcast?.nivel).toBe('HIGH');
    expect(result.current.broadcast?.escena).toEqual({ lat: 4.628, lng: -74.148 });
  });

  it('U8: drops a malformed wire frame instead of crashing the inbox', () => {
    const { port, result } = setup();

    // No `estado`: the validator rejects it, so nothing opens and nothing rings.
    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        solicitudId: 'REQ-1',
        emergenciaId: 'EMG-002',
        zonaId: 'Kennedy',
        ambulanciasNotificadas: ['AMB-01'],
        ambulanciaAsignadaId: null,
      }),
    );

    expect(result.current.broadcast).toBeNull();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('keeps the open request when a different request is cancelled', () => {
    const { port, result } = setup();

    act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));
    act(() =>
      port.emit(DESTINATIONS.solicitudes, { type: 'request.cancelled', requestId: 'REQ-OTHER' }),
    );

    expect(result.current.broadcast?.requestId).toBe('REQ-1');
  });

  /** Drives a full win so the mission lifecycle tests start from `en_route`. */
  function winMission(
    port: FakeRealtimePort,
    result: { current: ReturnType<typeof useSolicitudInbox> },
  ) {
    act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));
    act(() => result.current.accept());
    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        type: 'request.taken',
        requestId: 'REQ-1',
        winner: 'AMB-01',
      }),
    );
  }

  it('records the acceptance instant and publishes the arrival as a command', () => {
    const { port, result } = setup();
    winMission(port, result);

    expect(result.current.missionPhase).toBe('en_route');
    expect(result.current.mission?.acceptedAt).toBeGreaterThan(0);
    expect(result.current.mission?.arrivedAt).toBeNull();

    act(() => result.current.declareArrival());

    expect(port.published[port.published.length - 1]?.payload).toEqual({
      type: 'solicitud.llegada',
      requestId: 'REQ-1',
      ambulanceId: 'AMB-01',
    });
    // Still en_route: this client waits for the relay to echo the arrival.
    expect(result.current.missionPhase).toBe('en_route');
  });

  it('advances to arrived on request.arrived and ignores a repeat', () => {
    const { port, result } = setup();
    winMission(port, result);

    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        type: 'request.arrived',
        requestId: 'REQ-1',
        ambulanceId: 'AMB-01',
      }),
    );

    expect(result.current.missionPhase).toBe('arrived');
    const arrivedAt = result.current.mission?.arrivedAt;
    expect(arrivedAt).toBeGreaterThan(0);

    // A repeated arrival must not reset the instant.
    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        type: 'request.arrived',
        requestId: 'REQ-1',
        ambulanceId: 'AMB-01',
      }),
    );
    expect(result.current.mission?.arrivedAt).toBe(arrivedAt);
  });

  it('ignores an arrival that belongs to another request', () => {
    const { port, result } = setup();
    winMission(port, result);

    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        type: 'request.arrived',
        requestId: 'REQ-OTHER',
        ambulanceId: 'AMB-01',
      }),
    );

    expect(result.current.missionPhase).toBe('en_route');
  });

  it('marks the citizen confirmation once, then finishes the service', () => {
    const { port, result } = setup();
    winMission(port, result);
    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        type: 'request.arrived',
        requestId: 'REQ-1',
        ambulanceId: 'AMB-01',
      }),
    );

    act(() =>
      port.emit(DESTINATIONS.solicitudes, { type: 'request.confirmed', requestId: 'REQ-1' }),
    );
    expect(result.current.missionPhase).toBe('confirmed');
    const confirmedAt = result.current.mission?.confirmedAt;
    expect(confirmedAt).toBeGreaterThan(0);

    // A repeated confirmation must not reopen the notice or reset the instant.
    act(() =>
      port.emit(DESTINATIONS.solicitudes, { type: 'request.confirmed', requestId: 'REQ-1' }),
    );
    expect(result.current.mission?.confirmedAt).toBe(confirmedAt);

    act(() => result.current.finishService());
    expect(result.current.mission).toBeNull();
    expect(result.current.missionPhase).toBe('en_route');
  });
});
