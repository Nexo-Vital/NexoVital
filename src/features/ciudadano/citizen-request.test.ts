import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSolicitudesStore } from '@/features/solicitudes/solicitudes-store';
import { MOCK_AMBULANCIAS } from '@/mocks/fixtures';
import { DESTINATIONS } from '@/shared/realtime';
import { FakeRealtimePort } from '@/test/fake-realtime-port';
import type { AmbulanceState, Ambulancia } from '@/types/domain';
import {
  buildCitizenBroadcast,
  citizenSceneLabel,
  countAvailableUnits,
  formatUnitList,
  nearestAvailableUnits,
  searchElapsed,
  searchIntroText,
} from './citizen-request';
import { useCitizenRequestStore } from './citizen-request-store';

/** Origin used by the page when the device gives no position (Suba). */
const ORIGIN = { lat: 4.728, lng: -74.078 };

/** Minimal Response stand-in: apiFetch only reads status, ok, headers.get, json. */
function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

function amb(id: string, estado: AmbulanceState, lat: number, lng: number): Ambulancia {
  return {
    id,
    placa: `OVX-${id}`,
    estado,
    ubicacion: { lat, lng },
    zona: 'Suba',
    driverName: `Driver ${id}`,
  };
}

/** A fleet of only-busy units, so no request can be started. */
function allBusy(): Ambulancia[] {
  return MOCK_AMBULANCIAS.map((unit) => ({ ...unit, estado: 'ASSIGNED' as AmbulanceState }));
}

describe('nearestAvailableUnits', () => {
  it('picks the three nearest AVAILABLE units, nearest first', () => {
    const units = [
      amb('A-FAR', 'AVAILABLE', 4.9, -74.078),
      amb('A-NEAR', 'AVAILABLE', 4.729, -74.078),
      amb('A-MID', 'AVAILABLE', 4.75, -74.078),
      // Nearest of all, but busy: must never be offered.
      amb('A-BUSY', 'ASSIGNED', 4.7281, -74.078),
    ];

    expect(nearestAvailableUnits(units, ORIGIN).map((unit) => unit.id)).toEqual([
      'A-NEAR',
      'A-MID',
      'A-FAR',
    ]);
  });

  it('returns every available unit when there are fewer than three', () => {
    const units = [amb('A-1', 'AVAILABLE', 4.73, -74.078), amb('A-2', 'EN_ROUTE', 4.728, -74.078)];

    expect(nearestAvailableUnits(units, ORIGIN).map((unit) => unit.id)).toEqual(['A-1']);
  });

  it('returns an empty list when nothing is available', () => {
    expect(nearestAvailableUnits([amb('A-9', 'ASSIGNED', 4.7, -74.1)], ORIGIN)).toEqual([]);
  });

  it('counts only the available units', () => {
    expect(countAvailableUnits(MOCK_AMBULANCIAS)).toBe(3);
    expect(countAvailableUnits(allBusy())).toBe(0);
  });
});

describe('buildCitizenBroadcast', () => {
  it('alerts the three nearest available units and keeps the real scene', () => {
    const payload = buildCitizenBroadcast({
      requestId: 'REQ-1',
      origin: ORIGIN,
      units: MOCK_AMBULANCIAS,
      now: 1000,
    });

    expect(payload?.type).toBe('solicitud.broadcast');
    expect(payload?.notificadas).toEqual(['A-07', 'A-12', 'A-03']);
    expect(payload?.notifiedCount).toBe(3);
    expect(payload?.escena).toEqual(ORIGIN);
    // The real timeout window, never an invented one.
    expect(payload?.timeoutEn).toBe(new Date(1000 + 45_000).toISOString());
  });

  it('declares no severity and no zone for a citizen request', () => {
    const payload = buildCitizenBroadcast({
      requestId: 'REQ-1',
      origin: ORIGIN,
      units: MOCK_AMBULANCIAS,
      now: 1000,
    });

    // The citizen has no triage: publishing a level would show the driver a
    // severity nobody declared (C1), and `zonaId` must never carry coordinates
    // (C2) — the position already travels in `escena`.
    expect(payload?.nivel).toBeUndefined();
    expect(payload?.zonaId).toBe('');
    expect(payload?.escena).toEqual(ORIGIN);
  });

  it('returns null with zero available units, so no impossible search starts', () => {
    expect(
      buildCitizenBroadcast({ requestId: 'REQ-2', origin: ORIGIN, units: allBusy() }),
    ).toBeNull();
  });

  it('adjusts the notified count when fewer than three are available', () => {
    const one = MOCK_AMBULANCIAS.filter((unit) => unit.id === 'A-07');

    expect(
      buildCitizenBroadcast({ requestId: 'REQ-3', origin: ORIGIN, units: one })?.notifiedCount,
    ).toBe(1);
  });
});

describe('citizen request copy', () => {
  it('writes the real location, never an invented address', () => {
    expect(citizenSceneLabel(ORIGIN)).toBe('Tu ubicación actual · 4.7280, -74.0780');
  });

  it('labels the demo fallback as a reference point, never as the real location', () => {
    expect(citizenSceneLabel(ORIGIN, { fallback: true })).toBe(
      'Ubicación de referencia (demo) · 4.7280, -74.0780',
    );
    expect(citizenSceneLabel(ORIGIN, { fallback: true })).not.toContain('Tu ubicación actual');
  });

  it('adjusts the search intro to the number of alerted units', () => {
    expect(searchIntroText(3)).toContain('a las 3 ambulancias');
    expect(searchIntroText(2)).toContain('a las 2 ambulancias');
    expect(searchIntroText(1)).toContain('a la ambulancia disponible más cercana');
  });

  it('renders the elapsed search time as m:ss', () => {
    const now = new Date('2026-01-01T00:00:08.000Z');

    expect(searchElapsed(now.getTime() - 8000, now)).toBe('0:08');
    expect(searchElapsed(now.getTime() - 68_000, now)).toBe('1:08');
  });

  it('joins unit ids the Spanish way', () => {
    expect(formatUnitList(['A-09'])).toBe('A-09');
    expect(formatUnitList(['A-09', 'A-15'])).toBe('A-09 y A-15');
    expect(formatUnitList(['A-07', 'A-09', 'A-15'])).toBe('A-07, A-09 y A-15');
  });
});

describe('useCitizenRequestStore', () => {
  beforeEach(() => {
    // These cases exercise the DEMO path: the store must keep publishing on the
    // relay instead of calling the backend.
    vi.stubEnv('VITE_DEMO_MODE', '1');
  });

  afterEach(() => {
    useCitizenRequestStore.getState().reset();
    useSolicitudesStore.getState().hydrate([]);
    vi.unstubAllEnvs();
  });

  it('publishes the broadcast, mirrors it in the registry and stores the search state', async () => {
    const port = new FakeRealtimePort();

    const started = await useCitizenRequestStore.getState().start({
      port,
      units: MOCK_AMBULANCIAS,
      origin: ORIGIN,
      now: 5000,
    });

    expect(started).toBe(true);
    const frame = port.published.find((entry) => entry.destination === DESTINATIONS.solicitudes);
    expect(frame?.payload).toMatchObject({
      type: 'solicitud.broadcast',
      notificadas: ['A-07', 'A-12', 'A-03'],
    });

    const state = useCitizenRequestStore.getState();
    expect(state.phase).toBe('searching');
    expect(state.requestId).toBeTruthy();
    expect(state.startedAt).toBe(5000);
    expect(state.notifiedIds).toEqual(['A-07', 'A-12', 'A-03']);
    // Same path as the CRUE room: the request also lands in the registry.
    expect(useSolicitudesStore.getState().items.some((item) => item.id === state.requestId)).toBe(
      true,
    );
  });

  it('does not enter a search with zero available units and publishes nothing', async () => {
    const port = new FakeRealtimePort();

    const started = await useCitizenRequestStore.getState().start({
      port,
      units: allBusy(),
      origin: ORIGIN,
    });

    expect(started).toBe(false);
    expect(useCitizenRequestStore.getState().phase).toBe('idle');
    expect(port.published).toHaveLength(0);
  });

  it('cancel publishes solicitud.cancel and clears the local state', () => {
    const port = new FakeRealtimePort();
    useCitizenRequestStore.getState().start({ port, units: MOCK_AMBULANCIAS, origin: ORIGIN });
    const requestId = useCitizenRequestStore.getState().requestId;

    useCitizenRequestStore.getState().cancel(port);

    const cancel = port.published.find(
      (entry) => (entry.payload as { type?: string }).type === 'solicitud.cancel',
    );
    expect(cancel?.payload).toMatchObject({ type: 'solicitud.cancel', requestId });
    expect(useCitizenRequestStore.getState().phase).toBe('idle');
    expect(useCitizenRequestStore.getState().requestId).toBeNull();
    expect(useCitizenRequestStore.getState().notifiedIds).toEqual([]);
  });

  it('ends the search only when the arbiter assigns OUR request', () => {
    useCitizenRequestStore
      .getState()
      .start({ port: new FakeRealtimePort(), units: MOCK_AMBULANCIAS, origin: ORIGIN });
    const requestId = useCitizenRequestStore.getState().requestId ?? '';
    expect(useCitizenRequestStore.getState().acceptedAt).toBeNull();

    useCitizenRequestStore.getState().endOnTaken('REQ-OTHER', 'A-07');
    expect(useCitizenRequestStore.getState().phase).toBe('searching');
    expect(useCitizenRequestStore.getState().acceptedAt).toBeNull();

    useCitizenRequestStore.getState().endOnTaken(requestId, 'A-12');
    expect(useCitizenRequestStore.getState().phase).toBe('accepted');
    expect(useCitizenRequestStore.getState().acceptedBy).toBe('A-12');
    // The acceptance instant is real: it drives the rail's "hace N s".
    expect(useCitizenRequestStore.getState().acceptedAt).not.toBeNull();
  });

  it('is idempotent: a repeated request.taken keeps the first acceptance', () => {
    useCitizenRequestStore
      .getState()
      .start({ port: new FakeRealtimePort(), units: MOCK_AMBULANCIAS, origin: ORIGIN });
    const requestId = useCitizenRequestStore.getState().requestId ?? '';

    const nowSpy = vi.spyOn(Date, 'now');
    try {
      nowSpy.mockReturnValue(10_000);
      useCitizenRequestStore.getState().endOnTaken(requestId, 'A-12');
      expect(useCitizenRequestStore.getState().acceptedAt).toBe(10_000);
      expect(useCitizenRequestStore.getState().acceptedBy).toBe('A-12');

      // The same `request.taken` arrives again (relay replay, duplicate
      // delivery): the counter instant must not reset and the winner must not
      // change, so the popup cannot reopen.
      nowSpy.mockReturnValue(20_000);
      useCitizenRequestStore.getState().endOnTaken(requestId, 'A-99');
      expect(useCitizenRequestStore.getState().acceptedAt).toBe(10_000);
      expect(useCitizenRequestStore.getState().acceptedBy).toBe('A-12');

      // An acceptance for another request still never affects us, even now.
      useCitizenRequestStore.getState().endOnTaken('REQ-OTHER', 'A-07');
      expect(useCitizenRequestStore.getState().acceptedAt).toBe(10_000);
      expect(useCitizenRequestStore.getState().acceptedBy).toBe('A-12');
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('clears the acceptance instant on reset', () => {
    useCitizenRequestStore
      .getState()
      .start({ port: new FakeRealtimePort(), units: MOCK_AMBULANCIAS, origin: ORIGIN });
    const requestId = useCitizenRequestStore.getState().requestId ?? '';
    useCitizenRequestStore.getState().endOnTaken(requestId, 'A-12');
    expect(useCitizenRequestStore.getState().acceptedAt).not.toBeNull();

    useCitizenRequestStore.getState().reset();

    expect(useCitizenRequestStore.getState().acceptedAt).toBeNull();
    expect(useCitizenRequestStore.getState().acceptedBy).toBeNull();
  });
});

/** A server-shaped 201 body: the server owns id/estado/solicitadaEn/timeoutEn. */
const REST_RESPONSE = {
  id: '8b6f2f0e-0000-4000-8000-000000000042',
  emergenciaId: 'REQ-FRONT-1',
  estado: 'PENDIENTE',
  centroAyudaId: 'CA-CRUE',
  zonaId: '',
  solicitadaEn: '2026-01-01T00:00:00.000Z',
  timeoutEn: '2026-01-01T00:45:00.000Z',
  ambulanciasNotificadas: ['A-07', 'A-12', 'A-03'],
  ambulanciaAsignadaId: null,
};

describe('useCitizenRequestStore against the backend', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    // Demo mode OFF: the store must create the request through REST.
    vi.stubEnv('VITE_DEMO_MODE', '0');
    localStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    useCitizenRequestStore.getState().reset();
    useSolicitudesStore.getState().hydrate([]);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('creates the request through REST and stores the server response', async () => {
    fetchMock.mockResolvedValue(mockResponse(201, REST_RESPONSE));
    const port = new FakeRealtimePort();

    const started = await useCitizenRequestStore.getState().start({
      port,
      units: MOCK_AMBULANCIAS,
      origin: ORIGIN,
      now: 5000,
    });

    expect(started).toBe(true);
    // The backend is the only source of truth: nothing is published on the relay.
    expect(port.published).toHaveLength(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/v1/solicitudes');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body as string)).toEqual({
      emergenciaId: expect.any(String),
      centroAyudaId: 'CA-CRUE',
      zonaId: '',
      timeoutEn: new Date(5000 + 45_000).toISOString(),
    });

    // The stored identity and state come from the SERVER response, not the local
    // projection.
    const state = useCitizenRequestStore.getState();
    expect(state.phase).toBe('searching');
    expect(state.requestId).toBe(REST_RESPONSE.id);
    expect(state.startedAt).toBe(Date.parse(REST_RESPONSE.solicitadaEn));
    expect(state.notifiedIds).toEqual(REST_RESPONSE.ambulanciasNotificadas);

    const stored = useSolicitudesStore
      .getState()
      .items.find((item) => item.id === REST_RESPONSE.id);
    expect(stored).toMatchObject({
      estado: 'PENDING',
      zonaId: '',
      tipo: 'Solicitud de ambulancia',
    });
  });

  it('stays idle when the backend rejects the creation', async () => {
    fetchMock.mockResolvedValue(
      mockResponse(409, {
        codigo: 'AMBULANCIA_NO_DISPONIBLE',
        mensaje: 'No hay ambulancias disponibles para atender la solicitud.',
      }),
    );
    const port = new FakeRealtimePort();

    const started = await useCitizenRequestStore.getState().start({
      port,
      units: MOCK_AMBULANCIAS,
      origin: ORIGIN,
    });

    expect(started).toBe(false);
    expect(useCitizenRequestStore.getState().phase).toBe('idle');
    expect(useCitizenRequestStore.getState().requestId).toBeNull();
    expect(port.published).toHaveLength(0);
  });

  it('drops a malformed response instead of storing a half request', async () => {
    fetchMock.mockResolvedValue(mockResponse(201, { ok: true }));

    const started = await useCitizenRequestStore.getState().start({
      port: new FakeRealtimePort(),
      units: MOCK_AMBULANCIAS,
      origin: ORIGIN,
    });

    expect(started).toBe(false);
    expect(useCitizenRequestStore.getState().phase).toBe('idle');
    expect(useCitizenRequestStore.getState().requestId).toBeNull();
  });
});
