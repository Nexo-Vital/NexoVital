import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  afterEach(() => {
    cleanup();
    useToastStore.setState({ toasts: [] });
    useEmergencyStore.setState({ items: [] });
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

  it('shows a lost CAS as taken when the backend answers 409', async () => {
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

    expect(result.current.phase).toBe('rejected');
    expect(result.current.outcomeMessage).toBe('Solicitud ya asignada a otra ambulancia.');
    expect(result.current.mission).toBeNull();
  });

  it('treats ganador=false as a loss even on a 200 response', async () => {
    enableBackend();
    fetchMock.mockResolvedValue(mockResponse(200, acceptBody(false)));
    const { port, result } = setupBackend();

    act(() => port.emit(DESTINATIONS.solicitudes, REAL_BROADCAST));
    await act(async () => {
      result.current.accept();
    });

    expect(result.current.phase).toBe('taken');
    expect(result.current.mission).toBeNull();
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

    expect(result.current.phase).toBe('taken');
    expect(result.current.mission).toBeNull();
    expect(result.current.outcomeMessage).toBe('Tomada por 8b6f2f0e-0000-4000-8000-0000000000ff');
  });
});
