import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToastStore } from '@/components/ui/toast';
import { useEmergencyStore } from '@/features/emergencias/emergency-store';
import { useSolicitudesStore } from '@/features/solicitudes/solicitudes-store';
import {
  DESTINATIONS,
  type SolicitudBroadcastPayload,
  type SolicitudDirectPayload,
} from '@/shared/realtime';
import { FakeRealtimePort } from '@/test/fake-realtime-port';
import type { SolicitudAmbulancia } from '@/types/domain';
import {
  TAKEN_BY_OTHER_MESSAGE,
  UNIT_UNRESOLVED_REASON,
  UNKNOWN_REQUEST_REASON,
  useSolicitudInbox,
} from './use-solicitud-inbox';

/** Messages of the notices currently on screen. */
function toastMessages(): string[] {
  return useToastStore.getState().toasts.map((item) => item.message);
}

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
  beforeEach(() => {
    // These cases exercise the DEMO path: the hook must keep publishing the
    // accept/reject on the relay instead of calling the backend (FIX1).
    vi.stubEnv('VITE_DEMO_MODE', '1');
  });

  afterEach(() => {
    cleanup();
    // Both stores live at module scope: clear them so no case leaks into another.
    useToastStore.setState({ toasts: [] });
    useEmergencyStore.setState({ items: [] });
    useSolicitudesStore.setState({ items: [] });
    vi.unstubAllEnvs();
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

  it('drops the request at once, with its notice, when another unit wins', () => {
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

    // Nothing lingers: no "taken" card waiting to be dismissed.
    expect(result.current.broadcast).toBeNull();
    expect(result.current.phase).toBe('idle');
    expect(result.current.outcomeMessage).toBeNull();
    expect(result.current.mission).toBeNull();
    expect(toastMessages()).toContain(TAKEN_BY_OTHER_MESSAGE);
  });

  it('drops the request at once when a later accept is refused as already taken', () => {
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

    expect(result.current.broadcast).toBeNull();
    expect(result.current.phase).toBe('idle');
    expect(result.current.outcomeMessage).toBeNull();
    expect(toastMessages()).toContain(TAKEN_BY_OTHER_MESSAGE);
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

  it('surfaces an offer only while connected, holding it internally while offline', () => {
    const port = new FakeRealtimePort();
    const { result, rerender } = renderHook(
      ({ online }: { online: boolean }) =>
        useSolicitudInbox(port, 'AMB-01', { lat: 4.6, lng: -74.1 }, online),
      { initialProps: { online: false } },
    );

    // Received while disconnected: the transport delivered it, yet nothing is
    // surfaced (no card, so no accept/reject).
    act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));
    expect(result.current.broadcast).toBeNull();

    // Connecting re-surfaces the offer that is still within its accept window.
    rerender({ online: true });
    expect(result.current.broadcast?.requestId).toBe('REQ-1');

    // Disconnecting clears the surface again, without losing the frame: a later
    // reconnect would show it again.
    rerender({ online: false });
    expect(result.current.broadcast).toBeNull();
    rerender({ online: true });
    expect(result.current.broadcast?.requestId).toBe('REQ-1');
  });

  it('never gates the accepted mission on the connection', () => {
    const port = new FakeRealtimePort();
    const { result, rerender } = renderHook(
      ({ online }: { online: boolean }) =>
        useSolicitudInbox(port, 'AMB-01', { lat: 4.6, lng: -74.1 }, online),
      { initialProps: { online: true } },
    );

    winMission(port, result);
    expect(result.current.mission?.requestId).toBe('REQ-1');

    rerender({ online: false });

    // The mission is an in-progress service, not an offer: it stays surfaced.
    expect(result.current.mission?.requestId).toBe('REQ-1');
    expect(result.current.broadcast).toBeNull();
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

  it('raises no small toast on arrival: the pop-up of the console is the notice', () => {
    const { port, result } = setup();

    act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));

    expect(useToastStore.getState().toasts).toHaveLength(0);
    expect(result.current.broadcast?.requestId).toBe('REQ-1');
  });

  describe('one request at a time, in the order they were raised', () => {
    const second: SolicitudBroadcastPayload = { ...BROADCAST, requestId: 'REQ-2' };
    const third: SolicitudBroadcastPayload = { ...BROADCAST, requestId: 'REQ-3' };

    it('keeps the first request on the card when others arrive', () => {
      const { port, result } = setup();

      act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));
      const deadline = result.current.deadlineMs;
      act(() => port.emit(DESTINATIONS.solicitudes, second));
      act(() => port.emit(DESTINATIONS.solicitudes, third));

      // The request the driver is reading does not change, nor its countdown.
      expect(result.current.broadcast?.requestId).toBe('REQ-1');
      expect(result.current.deadlineMs).toBe(deadline);
      expect(result.current.queuedIds).toEqual(['REQ-2', 'REQ-3']);
    });

    it('hands the card to the next one when the first is taken, cancelled or expired', () => {
      const { port, result } = setup();
      act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));
      act(() => port.emit(DESTINATIONS.solicitudes, second));
      act(() => port.emit(DESTINATIONS.solicitudes, third));

      act(() =>
        port.emit(DESTINATIONS.solicitudes, {
          type: 'request.taken',
          requestId: 'REQ-1',
          winner: 'AMB-03',
        }),
      );
      expect(result.current.broadcast?.requestId).toBe('REQ-2');
      expect(result.current.phase).toBe('idle');
      expect(result.current.queuedIds).toEqual(['REQ-3']);

      act(() =>
        port.emit(DESTINATIONS.solicitudes, { type: 'request.cancelled', requestId: 'REQ-2' }),
      );
      expect(result.current.broadcast?.requestId).toBe('REQ-3');
      expect(result.current.queuedIds).toEqual([]);

      act(() =>
        port.emit(DESTINATIONS.solicitudes, { type: 'request.expired', requestId: 'REQ-3' }),
      );
      expect(result.current.broadcast).toBeNull();
    });

    it('drops a waiting request that stops being available, without touching the card', () => {
      const { port, result } = setup();
      act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));
      act(() => port.emit(DESTINATIONS.solicitudes, second));
      act(() => port.emit(DESTINATIONS.solicitudes, third));

      act(() =>
        port.emit(DESTINATIONS.solicitudes, { type: 'request.cancelled', requestId: 'REQ-2' }),
      );

      expect(result.current.broadcast?.requestId).toBe('REQ-1');
      expect(result.current.queuedIds).toEqual(['REQ-3']);
    });

    it('offers the next one after the driver rejects the first', () => {
      vi.useFakeTimers();
      try {
        const { port, result } = setup();
        act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));
        act(() => port.emit(DESTINATIONS.solicitudes, second));

        act(() => result.current.reject());
        // The answer stays on the card for a moment; the next one waits.
        expect(result.current.phase).toBe('rejected');
        expect(result.current.broadcast?.requestId).toBe('REQ-1');

        act(() => {
          vi.advanceTimersByTime(3000);
        });
        expect(result.current.broadcast?.requestId).toBe('REQ-2');
        expect(result.current.phase).toBe('idle');
      } finally {
        vi.useRealTimers();
      }
    });

    it('skips a waiting request whose window closed while it waited', () => {
      vi.useFakeTimers();
      try {
        const { port, result } = setup();
        const now = Date.now();
        act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));
        act(() =>
          port.emit(DESTINATIONS.solicitudes, {
            ...second,
            timeoutEn: new Date(now + 5_000).toISOString(),
            timeoutMs: 5_000,
          }),
        );
        act(() => port.emit(DESTINATIONS.solicitudes, third));
        expect(result.current.queuedIds).toEqual(['REQ-2', 'REQ-3']);

        act(() => {
          vi.advanceTimersByTime(10_000);
        });
        act(() =>
          port.emit(DESTINATIONS.solicitudes, { type: 'request.cancelled', requestId: 'REQ-1' }),
        );

        // REQ-2 has no time left: it is never offered.
        expect(result.current.broadcast?.requestId).toBe('REQ-3');
        expect(result.current.queuedIds).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('puts a request that is older than the open one first', () => {
      const { port, result } = setup();
      const now = Date.now();
      // Raised 5 s ago.
      act(() =>
        port.emit(DESTINATIONS.solicitudes, {
          ...BROADCAST,
          timeoutEn: new Date(now + 40_000).toISOString(),
          timeoutMs: 45_000,
        }),
      );
      // Raised 20 s ago: the server offers it late, in the same burst.
      act(() =>
        port.emit(DESTINATIONS.solicitudes, {
          ...second,
          timeoutEn: new Date(now + 25_000).toISOString(),
          timeoutMs: 45_000,
        }),
      );

      expect(result.current.broadcast?.requestId).toBe('REQ-2');
      expect(result.current.deadlineMs).toBe(Date.parse(new Date(now + 25_000).toISOString()));
      expect(result.current.queuedIds).toEqual(['REQ-1']);
    });

    it('never moves the request the driver is already answering', () => {
      const { port, result } = setup();
      const now = Date.now();
      act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));
      act(() => result.current.accept());
      expect(result.current.phase).toBe('submitting');

      act(() =>
        port.emit(DESTINATIONS.solicitudes, {
          ...second,
          timeoutEn: new Date(now + 5_000).toISOString(),
          timeoutMs: 45_000,
        }),
      );

      expect(result.current.broadcast?.requestId).toBe('REQ-1');
      expect(result.current.phase).toBe('submitting');
      expect(result.current.queuedIds).toEqual(['REQ-2']);
    });

    it('does not restart a request that is delivered twice', () => {
      const { port, result } = setup();
      const creation: SolicitudBroadcastPayload = { ...BROADCAST, timeoutEn: '' };
      act(() => port.emit(DESTINATIONS.solicitudes, creation));
      const deadline = result.current.deadlineMs;
      act(() => result.current.accept());

      act(() => port.emit(DESTINATIONS.solicitudes, creation));

      expect(result.current.phase).toBe('submitting');
      expect(result.current.deadlineMs).toBe(deadline);
      expect(result.current.queuedIds).toEqual([]);
    });

    it('winning a request leaves nothing waiting: a unit in a mission answers no other', () => {
      const { port, result } = setup();
      act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));
      act(() => port.emit(DESTINATIONS.solicitudes, second));
      act(() => result.current.accept());
      act(() =>
        port.emit(DESTINATIONS.solicitudes, {
          type: 'request.taken',
          requestId: 'REQ-1',
          winner: 'AMB-01',
        }),
      );

      expect(result.current.mission?.requestId).toBe('REQ-1');
      expect(result.current.queuedIds).toEqual([]);
    });

    it('hides the waiting requests while the driver is not receiving', () => {
      const port = new FakeRealtimePort();
      const { result, rerender } = renderHook(
        ({ online }: { online: boolean }) =>
          useSolicitudInbox(port, 'AMB-01', { lat: 4.6, lng: -74.1 }, online),
        { initialProps: { online: true } },
      );
      act(() => port.emit(DESTINATIONS.solicitudes, BROADCAST));
      act(() => port.emit(DESTINATIONS.solicitudes, second));

      rerender({ online: false });
      expect(result.current.broadcast).toBeNull();
      expect(result.current.queuedIds).toEqual([]);

      rerender({ online: true });
      expect(result.current.broadcast?.requestId).toBe('REQ-1');
      expect(result.current.queuedIds).toEqual(['REQ-2']);
    });
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

  it('marks the citizen confirmation once, then finishes the service', async () => {
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

    await act(async () => {
      await result.current.finishService();
    });
    expect(result.current.mission).toBeNull();
    expect(result.current.missionPhase).toBe('en_route');
  });
});

/**
 * FIX1/FIX3 against the real backend: `VITE_DEMO_MODE` off, the accept/reject
 * are REST commands (`POST /solicitudes/{id}/accept|reject`) and the winner is
 * the server's real ambulance UUID, not a demo label.
 */
describe('useSolicitudInbox against the backend (no demo mode)', () => {
  const fetchMock = vi.fn();

  /** A real ambulance UUID the winner frame carries. */
  const REAL_UNIT = '8b6f2f0e-0000-4000-8000-0000000000a2';
  const REAL_REQUEST = '8b6f2f0e-0000-4000-8000-000000000042';

  const REAL_BROADCAST: SolicitudBroadcastPayload = {
    ...BROADCAST,
    requestId: REAL_REQUEST,
    notificadas: [REAL_UNIT],
  };

  /** A live-shaped accept body with `ganador` and the nested request. */
  function acceptBody(winner: boolean) {
    return {
      ganador: winner,
      solicitud: {
        id: REAL_REQUEST,
        ubicacion: { lat: 4.72, lng: -74.08 },
        emergenciaId: 'EMG-002',
        estado: 'ASIGNADA',
        centroAyudaId: 'CA-1',
        zonaId: 'Kennedy',
        solicitadaEn: '2026-01-01T00:00:00.000Z',
        timeoutEn: '2026-01-01T00:45:00.000Z',
        ambulanciasNotificadas: [REAL_UNIT],
        ambulanciaAsignadaId: winner ? REAL_UNIT : null,
      },
    };
  }

  function mockResponse(status: number, body: unknown): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      json: async () => body,
    } as unknown as Response;
  }

  function setupBackend() {
    const port = new FakeRealtimePort();
    const view = renderHook(() => useSolicitudInbox(port, REAL_UNIT, { lat: 4.6, lng: -74.1 }));
    return { port, ...view };
  }

  /**
   * A registry row the unit was notified about, NOT delivered as the inbox's
   * open broadcast. `respondTo` must answer it by its own id.
   */
  function notifiedRow(): SolicitudAmbulancia {
    return {
      id: REAL_REQUEST,
      emergenciaId: 'EMG-002',
      estado: 'PENDING',
      centroAyudaId: '',
      zonaId: 'Kennedy',
      ubicacion: { lat: 4.72, lng: -74.08 },
      tipo: 'Traffic collision',
      solicitadaEn: '2026-01-01T00:00:00.000Z',
      timeoutEn: '2026-01-01T00:45:00.000Z',
      ambulanciasNotificadas: [REAL_UNIT],
      notifiedCount: 1,
      ambulanciaAsignadaId: null,
    };
  }

  afterEach(() => {
    cleanup();
    useToastStore.setState({ toasts: [] });
    useEmergencyStore.setState({ items: [] });
    useSolicitudesStore.setState({ items: [] });
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  function enableBackend() {
    vi.stubEnv('VITE_DEMO_MODE', '0');
    localStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  }

  it('accepts through REST and adopts the server win', async () => {
    enableBackend();
    fetchMock.mockResolvedValue(mockResponse(200, acceptBody(true)));
    const { port, result } = setupBackend();

    act(() => port.emit(DESTINATIONS.solicitudes, REAL_BROADCAST));
    await act(async () => {
      result.current.accept();
    });

    const [path, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/api/v1/solicitudes/${REAL_REQUEST}/accept`);
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body as string)).toEqual({ ambulanciaId: REAL_UNIT });
    // The port is NOT used for the accept against a real backend.
    expect(port.published).toHaveLength(0);
    expect(result.current.phase).toBe('assigned');
    expect(result.current.mission?.requestId).toBe(REAL_REQUEST);
  });

  it('a lost CAS (409) drops the request at once, with its notice', async () => {
    enableBackend();
    fetchMock.mockResolvedValue(
      mockResponse(409, {
        codigo: 'CAS_PERDIDO',
        mensaje: 'Solicitud ya asignada a otra ambulancia.',
      }),
    );
    const { port, result } = setupBackend();

    act(() => port.emit(DESTINATIONS.solicitudes, REAL_BROADCAST));
    await act(async () => {
      result.current.accept();
    });

    // It does not stay on screen as a refused card with the server's text.
    expect(result.current.broadcast).toBeNull();
    expect(result.current.phase).toBe('idle');
    expect(result.current.outcomeMessage).toBeNull();
    expect(result.current.mission).toBeNull();
    expect(toastMessages()).toEqual(expect.arrayContaining([TAKEN_BY_OTHER_MESSAGE]));
    // One notice, even though the loss can be learnt more than once.
    expect(toastMessages().filter((message) => message === TAKEN_BY_OTHER_MESSAGE)).toHaveLength(1);
  });

  it('SOLICITUD_NO_ASIGNABLE (the request was already assigned) is the same loss', async () => {
    enableBackend();
    fetchMock.mockResolvedValue(
      mockResponse(409, {
        codigo: 'SOLICITUD_NO_ASIGNABLE',
        mensaje: 'La solicitud ya no admite esa transición.',
      }),
    );
    const { port, result } = setupBackend();

    act(() => port.emit(DESTINATIONS.solicitudes, REAL_BROADCAST));
    await act(async () => {
      result.current.accept();
    });

    expect(result.current.broadcast).toBeNull();
    expect(result.current.phase).toBe('idle');
    expect(toastMessages()).toContain(TAKEN_BY_OTHER_MESSAGE);
    // The server's technical text is not what the driver reads.
    expect(toastMessages()).not.toContain('La solicitud ya no admite esa transición.');
  });

  it('another refusal (the unit is busy) is NOT announced as taken by another unit', async () => {
    enableBackend();
    fetchMock.mockResolvedValue(
      mockResponse(409, {
        codigo: 'AMBULANCIA_NO_DISPONIBLE',
        mensaje: 'No hay ambulancias disponibles para atender la solicitud.',
      }),
    );
    const { port, result } = setupBackend();

    act(() => port.emit(DESTINATIONS.solicitudes, REAL_BROADCAST));
    await act(async () => {
      result.current.accept();
    });

    expect(result.current.phase).toBe('rejected');
    expect(result.current.outcomeMessage).toBe(
      'No hay ambulancias disponibles para atender la solicitud.',
    );
    expect(toastMessages()).not.toContain(TAKEN_BY_OTHER_MESSAGE);
  });

  it('treats ganador=false as a loss even on a 200 response', async () => {
    enableBackend();
    fetchMock.mockResolvedValue(mockResponse(200, acceptBody(false)));
    const { port, result } = setupBackend();

    act(() => port.emit(DESTINATIONS.solicitudes, REAL_BROADCAST));
    await act(async () => {
      result.current.accept();
    });

    expect(result.current.broadcast).toBeNull();
    expect(result.current.phase).toBe('idle');
    expect(result.current.mission).toBeNull();
    expect(toastMessages()).toContain(TAKEN_BY_OTHER_MESSAGE);
  });

  it('RES-3: respondTo answers a selected registry row by its OWN id through REST', async () => {
    enableBackend();
    fetchMock.mockResolvedValue(mockResponse(200, acceptBody(true)));
    const { port, result } = setupBackend();

    // No open broadcast: the row arrived earlier and the inbox no longer holds
    // it as its single active request. The server still accepts it by id.
    await act(async () => {
      result.current.respondTo(notifiedRow(), 'accept');
    });

    const [path, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/api/v1/solicitudes/${REAL_REQUEST}/accept`);
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body as string)).toEqual({ ambulanciaId: REAL_UNIT });
    // The inbox's broadcast slot is untouched: no publish, no broadcast.
    expect(port.published).toHaveLength(0);
    expect(result.current.broadcast).toBeNull();
    // The SERVER's win is adopted, honestly reported against that row.
    expect(result.current.responseOutcome).toEqual({
      requestId: REAL_REQUEST,
      phase: 'assigned',
      message: 'Te la asignaron',
    });
    expect(result.current.mission?.requestId).toBe(REAL_REQUEST);
  });

  it('RES-4: respondTo never reports success when the backend wins the CAS', async () => {
    enableBackend();
    fetchMock.mockResolvedValue(
      mockResponse(409, {
        codigo: 'CAS_PERDIDO',
        mensaje: 'Solicitud ya asignada a otra ambulancia.',
      }),
    );
    const { result } = setupBackend();

    await act(async () => {
      result.current.respondTo(notifiedRow(), 'accept');
    });

    // The row does not keep an outcome on screen: it is gone, with its notice.
    expect(result.current.responseOutcome).toBeNull();
    expect(result.current.mission).toBeNull();
    expect(toastMessages()).toContain(TAKEN_BY_OTHER_MESSAGE);
  });

  it('rejects through REST and records the rejection', async () => {
    enableBackend();
    fetchMock.mockResolvedValue(
      mockResponse(200, {
        ...acceptBody(true).solicitud,
        estado: 'PENDIENTE',
        ambulanciaAsignadaId: null,
      }),
    );
    const { port, result } = setupBackend();

    act(() => port.emit(DESTINATIONS.solicitudes, REAL_BROADCAST));
    await act(async () => {
      result.current.reject();
    });

    const [path, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/api/v1/solicitudes/${REAL_REQUEST}/reject`);
    expect(JSON.parse(options.body as string)).toEqual({ ambulanciaId: REAL_UNIT });
    expect(port.published).toHaveLength(0);
    expect(result.current.phase).toBe('rejected');
    expect(result.current.outcomeMessage).toBe('Solicitud rechazada');
  });

  /*
    EP-04.F2.US5: a decline is final for the unit that made it. The server
    records it, so the console marks the registry row and stops offering the
    request, while the row itself stays listed because the request is still
    open for the other units.
  */
  function rowInRegistry(): SolicitudAmbulancia | undefined {
    return useSolicitudesStore.getState().items.find((item) => item.id === REAL_REQUEST);
  }

  it('US5: declining from the card marks the registry row and keeps it listed', async () => {
    enableBackend();
    fetchMock.mockResolvedValue(
      mockResponse(200, {
        ...acceptBody(true).solicitud,
        estado: 'PENDIENTE',
        ambulanciaAsignadaId: null,
        ambulanciasRechazaron: [REAL_UNIT],
      }),
    );
    useSolicitudesStore.getState().upsert(notifiedRow());
    const { port, result } = setupBackend();

    act(() => port.emit(DESTINATIONS.solicitudes, REAL_BROADCAST));
    await act(async () => {
      result.current.reject();
    });

    expect(rowInRegistry()?.estado).toBe('PENDING');
    expect(rowInRegistry()?.ambulanciasRechazaron).toEqual([REAL_UNIT]);
    // Declining is not "another unit took it".
    expect(toastMessages()).not.toContain(TAKEN_BY_OTHER_MESSAGE);
  });

  it('US5: declining from the detail frees the card when it was the open offer', async () => {
    enableBackend();
    fetchMock.mockResolvedValue(
      mockResponse(200, {
        ...acceptBody(true).solicitud,
        estado: 'PENDIENTE',
        ambulanciaAsignadaId: null,
        ambulanciasRechazaron: [REAL_UNIT],
      }),
    );
    useSolicitudesStore.getState().upsert(notifiedRow());
    const { port, result } = setupBackend();

    act(() => port.emit(DESTINATIONS.solicitudes, REAL_BROADCAST));
    expect(result.current.broadcast?.requestId).toBe(REAL_REQUEST);
    await act(async () => {
      result.current.respondTo(notifiedRow(), 'reject');
    });

    const [path] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/api/v1/solicitudes/${REAL_REQUEST}/reject`);
    // The request is never left on screen asking for an answer it cannot get.
    expect(result.current.broadcast).toBeNull();
    expect(result.current.phase).toBe('idle');
    expect(result.current.responseOutcome).toEqual({
      requestId: REAL_REQUEST,
      phase: 'rejected',
      message: 'Solicitud rechazada',
    });
    expect(rowInRegistry()?.ambulanciasRechazaron).toEqual([REAL_UNIT]);
  });

  it('US5: a failed decline marks nothing, so the driver can answer again', async () => {
    enableBackend();
    fetchMock.mockResolvedValue(
      mockResponse(500, { codigo: 'ERROR_RECHAZO_SOLICITUD', mensaje: 'No fue posible rechazar.' }),
    );
    useSolicitudesStore.getState().upsert(notifiedRow());
    const { result } = setupBackend();

    await act(async () => {
      result.current.respondTo(notifiedRow(), 'reject');
    });

    expect(rowInRegistry()?.ambulanciasRechazaron ?? []).toEqual([]);
  });

  it('US5: an accept the server refuses as already declined marks the row, without the "taken" notice', async () => {
    enableBackend();
    fetchMock.mockResolvedValue(
      mockResponse(409, {
        codigo: 'SOLICITUD_YA_RECHAZADA',
        mensaje: 'Ya rechazaste esta solicitud.',
      }),
    );
    useSolicitudesStore.getState().upsert(notifiedRow());
    const { result } = setupBackend();

    await act(async () => {
      result.current.respondTo(notifiedRow(), 'accept');
    });

    // The request is still open for the other units: the row stays, marked.
    expect(rowInRegistry()?.estado).toBe('PENDING');
    expect(rowInRegistry()?.ambulanciasRechazaron).toEqual([REAL_UNIT]);
    expect(result.current.mission).toBeNull();
    expect(toastMessages()).not.toContain(TAKEN_BY_OTHER_MESSAGE);
    // The server's own reason is what the detail shows.
    expect(result.current.responseOutcome?.requestId).toBe(REAL_REQUEST);
    expect(result.current.responseOutcome?.message).toBe('Ya rechazaste esta solicitud.');
  });

  it('FIX B: refuses to accept or reject while the own unit is unresolved', async () => {
    enableBackend();
    const port = new FakeRealtimePort();
    // Empty ambulance id: off-demo this is "the server has not resolved my unit".
    const { result } = renderHook(() => useSolicitudInbox(port, '', { lat: 4.6, lng: -74.1 }));

    // The backend delivers a per-user WIRE frame (no L3 filter), which is exactly
    // the case where an unresolved unit would otherwise bid with an empty id.
    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        solicitudId: REAL_REQUEST,
        emergenciaId: 'EMG-002',
        zonaId: 'Kennedy',
        estado: 'PENDIENTE',
        ambulanciasNotificadas: [REAL_UNIT],
        ambulanciaAsignadaId: null,
      }),
    );
    expect(result.current.broadcast?.requestId).toBe(REAL_REQUEST);

    await act(async () => {
      result.current.accept();
    });

    // No 400: nothing is sent, the card stays open with the honest reason.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.phase).toBe('idle');
    expect(result.current.outcomeMessage).toBe(UNIT_UNRESOLVED_REASON);

    await act(async () => {
      result.current.reject();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.phase).toBe('idle');
  });

  it('refuses to answer a request id that is not a server UUID', async () => {
    enableBackend();
    const { port, result } = setupBackend();

    // A fixture-shaped broadcast (not a backend wire frame): its `REQ-1` id would
    // be sent as a REST path segment the server does not know.
    act(() => port.emit(DESTINATIONS.solicitudes, { ...BROADCAST, notificadas: [REAL_UNIT] }));
    expect(result.current.broadcast?.requestId).toBe('REQ-1');

    await act(async () => {
      result.current.accept();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.outcomeMessage).toBe(UNKNOWN_REQUEST_REASON);

    await act(async () => {
      result.current.reject();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.outcomeMessage).toBe(UNKNOWN_REQUEST_REASON);
  });

  it('declares arrival through REST and adopts the server milestone', async () => {
    enableBackend();
    fetchMock.mockResolvedValue(
      mockResponse(200, { ...acceptBody(true).solicitud, estado: 'ASIGNADA' }),
    );
    const { port, result } = setupBackend();

    act(() => port.emit(DESTINATIONS.solicitudes, REAL_BROADCAST));
    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        type: 'request.taken',
        requestId: REAL_REQUEST,
        winner: REAL_UNIT,
      }),
    );
    expect(result.current.missionPhase).toBe('en_route');

    await act(async () => {
      result.current.declareArrival();
    });

    const [path, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/api/v1/solicitudes/${REAL_REQUEST}/llegada`);
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body as string)).toEqual({ ambulanciaId: REAL_UNIT });
    // The SERVER confirmed the milestone, so the mission advances locally.
    expect(result.current.missionPhase).toBe('arrived');
    expect(result.current.mission?.arrivedAt).toBeGreaterThan(0);
  });

  it('FIX3: the driver gets the mission when the server winner is its OWN real unit', async () => {
    enableBackend();
    fetchMock.mockResolvedValue(new Promise(() => {}));
    const { port, result } = setupBackend();

    act(() => port.emit(DESTINATIONS.solicitudes, REAL_BROADCAST));
    // The backend pushes ASIGNADA as a wire frame; the reconciled union frame
    // names the real winner. It matches this driver's unit, so it wins.
    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        type: 'request.taken',
        requestId: REAL_REQUEST,
        winner: REAL_UNIT,
      }),
    );

    expect(result.current.phase).toBe('assigned');
    expect(result.current.mission?.requestId).toBe(REAL_REQUEST);
  });

  it('FIX3: the driver does NOT get the mission when the winner is another unit', async () => {
    enableBackend();
    fetchMock.mockResolvedValue(new Promise(() => {}));
    const { port, result } = setupBackend();

    act(() => port.emit(DESTINATIONS.solicitudes, REAL_BROADCAST));
    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        type: 'request.taken',
        requestId: REAL_REQUEST,
        winner: '8b6f2f0e-0000-4000-8000-0000000000ff',
      }),
    );

    expect(result.current.broadcast).toBeNull();
    expect(result.current.phase).toBe('idle');
    expect(result.current.mission).toBeNull();
    expect(result.current.outcomeMessage).toBeNull();
    expect(toastMessages()).toContain(TAKEN_BY_OTHER_MESSAGE);
  });

  it('the backend ASIGNADA frame of another unit drops the card at once', () => {
    enableBackend();
    const { port, result } = setupBackend();

    act(() => port.emit(DESTINATIONS.solicitudes, REAL_BROADCAST));
    // The server tells every notified unit who won (EP-04.F2.US4, C-03).
    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        solicitudId: REAL_REQUEST,
        emergenciaId: null,
        zonaId: null,
        estado: 'ASIGNADA',
        ambulanciasNotificadas: [],
        ambulanciaAsignadaId: '8b6f2f0e-0000-4000-8000-0000000000ff',
        ubicacion: null,
        llegada: false,
      }),
    );

    expect(result.current.broadcast).toBeNull();
    expect(result.current.phase).toBe('idle');
    expect(result.current.mission).toBeNull();
    expect(toastMessages()).toContain(TAKEN_BY_OTHER_MESSAGE);
  });

  it('that frame also drops a request that was only a registry row', () => {
    enableBackend();
    const { port, result } = setupBackend();
    useSolicitudesStore.getState().upsert(notifiedRow());

    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        solicitudId: REAL_REQUEST,
        emergenciaId: null,
        zonaId: null,
        estado: 'ASIGNADA',
        ambulanciasNotificadas: [],
        ambulanciaAsignadaId: '8b6f2f0e-0000-4000-8000-0000000000ff',
        ubicacion: null,
        llegada: false,
      }),
    );

    expect(useSolicitudesStore.getState().items).toEqual([]);
    expect(result.current.broadcast).toBeNull();
    expect(toastMessages()).toContain(TAKEN_BY_OTHER_MESSAGE);
  });

  it('the ASIGNADA frame of THIS unit is never read as a loss', () => {
    enableBackend();
    const { port, result } = setupBackend();

    act(() => port.emit(DESTINATIONS.solicitudes, REAL_BROADCAST));
    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        solicitudId: REAL_REQUEST,
        emergenciaId: null,
        zonaId: null,
        estado: 'ASIGNADA',
        ambulanciasNotificadas: [],
        ambulanciaAsignadaId: REAL_UNIT,
        ubicacion: null,
        llegada: false,
      }),
    );

    expect(result.current.mission?.requestId).toBe(REAL_REQUEST);
    expect(toastMessages()).not.toContain(TAKEN_BY_OTHER_MESSAGE);
  });

  it('drops the driver card on the backend CANCELADA wire frame', () => {
    enableBackend();
    const { port, result } = setupBackend();

    act(() => port.emit(DESTINATIONS.solicitudes, REAL_BROADCAST));
    expect(result.current.broadcast?.requestId).toBe(REAL_REQUEST);

    // The backend speaks its own shape: no `type`, the whole-request state in
    // `estado`. A CANCELADA frame means the requester withdrew before any unit
    // accepted, so this inbox must stop offering the mission.
    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        solicitudId: REAL_REQUEST,
        emergenciaId: null,
        zonaId: null,
        estado: 'CANCELADA',
        ambulanciasNotificadas: [REAL_UNIT],
        ambulanciaAsignadaId: null,
        ubicacion: null,
      }),
    );

    expect(result.current.broadcast).toBeNull();
    expect(result.current.phase).toBe('idle');
  });

  it('finishes through REST, only clears on the server 200 and sends the unit', async () => {
    enableBackend();
    fetchMock.mockResolvedValue(
      mockResponse(200, { ...acceptBody(true).solicitud, estado: 'TOMADA' }),
    );
    const { port, result } = setupBackend();

    act(() => port.emit(DESTINATIONS.solicitudes, REAL_BROADCAST));
    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        type: 'request.taken',
        requestId: REAL_REQUEST,
        winner: REAL_UNIT,
      }),
    );
    expect(result.current.mission).not.toBeNull();

    let finished = false;
    await act(async () => {
      finished = await result.current.finishService();
    });

    const [path, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/api/v1/solicitudes/${REAL_REQUEST}/finalizar`);
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body as string)).toEqual({ ambulanciaId: REAL_UNIT });
    expect(finished).toBe(true);
    expect(result.current.mission).toBeNull();
  });

  it('keeps the mission and reports the failure when the backend refuses the finish', async () => {
    enableBackend();
    fetchMock.mockResolvedValue(
      mockResponse(409, {
        codigo: 'SOLICITUD_NO_ASIGNABLE',
        mensaje: 'La solicitud ya no admite esa transición.',
      }),
    );
    const { port, result } = setupBackend();

    act(() => port.emit(DESTINATIONS.solicitudes, REAL_BROADCAST));
    act(() =>
      port.emit(DESTINATIONS.solicitudes, {
        type: 'request.taken',
        requestId: REAL_REQUEST,
        winner: REAL_UNIT,
      }),
    );

    let finished = true;
    await act(async () => {
      finished = await result.current.finishService();
    });

    expect(finished).toBe(false);
    expect(result.current.mission).not.toBeNull();
    expect(result.current.outcomeMessage).toBe('La solicitud ya no admite esa transición.');
  });
});
