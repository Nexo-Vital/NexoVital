import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSolicitudesStore } from '@/features/solicitudes/solicitudes-store';
import { MOCK_AMBULANCIAS } from '@/mocks/fixtures';
import { DESTINATIONS } from '@/shared/realtime';
import { FakeRealtimePort } from '@/test/fake-realtime-port';
import type { AmbulanceState, Ambulancia, CentroAyuda, Emergencia } from '@/types/domain';
import {
  buildCitizenBroadcast,
  CITIZEN_REQUEST_REASONS,
  citizenSceneLabel,
  countAvailableUnits,
  formatUnitList,
  latestActiveEmergency,
  nearestAvailableUnits,
  nearestCentro,
  searchElapsed,
  searchIntroText,
} from './citizen-request';
import { useCitizenRequestStore } from './citizen-request-store';

/** Origin used by the page when the device gives no position (Suba). */
const ORIGIN = { lat: 4.728, lng: -74.078 };

/** A backend-shaped emergency id (the contract field is a `UUID`). */
const EMERGENCY_ID = '0b6f2f0e-1111-4000-8000-0000000000aa';
/** A backend-shaped aid-center id from the map read-model. */
const CENTRO_ID = '1c7a3a1e-2222-4000-8000-0000000000bb';

function emergencia(overrides: Partial<Emergencia> = {}): Emergencia {
  return {
    id: EMERGENCY_ID,
    ubicacion: { lat: 4.728, lng: -74.078 },
    nivel: 'HIGH',
    estado: 'REPORTED',
    descripcion: 'Derrumbe en Suba',
    zonaId: 'ZONA-SUBA',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function centroAyuda(id: string, lat: number, lng: number, zonaId?: string): CentroAyuda {
  return {
    id,
    nombre: `Centro ${id}`,
    ubicacion: { lat, lng },
    items: [],
    ...(zonaId === undefined ? {} : { zonaId }),
  };
}

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

describe('latestActiveEmergency', () => {
  it('picks the most recently created ACTIVE emergency', () => {
    const older = emergencia({
      id: 'EMG-OLD',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const newer = emergencia({
      id: 'EMG-NEW',
      createdAt: '2026-01-01T01:00:00.000Z',
    });

    expect(latestActiveEmergency([newer, older])?.id).toBe('EMG-NEW');
    expect(latestActiveEmergency([older, newer])?.id).toBe('EMG-NEW');
  });

  it('ignores resolved and closed emergencies and returns null with none', () => {
    expect(latestActiveEmergency([])).toBeNull();
    expect(
      latestActiveEmergency([
        emergencia({ id: 'EMG-RESOLVED', estado: 'RESOLVED' }),
        emergencia({ id: 'EMG-CLOSED', estado: 'CLOSED' }),
      ]),
    ).toBeNull();
  });

  it('keeps an emergency that is being handled (IN_PROGRESS)', () => {
    expect(latestActiveEmergency([emergencia({ estado: 'IN_PROGRESS' })])?.id).toBe(EMERGENCY_ID);
  });
});

describe('nearestCentro', () => {
  it('picks the nearest center to the citizen, whatever the list order', () => {
    const far = centroAyuda('C-FAR', 4.9, -74.078);
    const near = centroAyuda('C-NEAR', 4.729, -74.078);

    expect(nearestCentro([far, near], ORIGIN)?.id).toBe('C-NEAR');
    expect(nearestCentro([near, far], ORIGIN)?.id).toBe('C-NEAR');
  });

  it('returns null when the map holds no center', () => {
    expect(nearestCentro([], ORIGIN)).toBeNull();
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
  emergenciaId: EMERGENCY_ID,
  estado: 'PENDIENTE',
  centroAyudaId: CENTRO_ID,
  zonaId: 'ZONA-SUBA',
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

  it('sends the REAL emergency, its zone and the nearest center, then stores the response', async () => {
    fetchMock.mockResolvedValue(mockResponse(201, REST_RESPONSE));
    const port = new FakeRealtimePort();

    const started = await useCitizenRequestStore.getState().start({
      port,
      units: MOCK_AMBULANCIAS,
      origin: ORIGIN,
      now: 5000,
      emergencies: [emergencia()],
      // The nearest center is the one at the origin's latitude; the far one must
      // never be chosen.
      centros: [
        centroAyuda('C-FAR', 4.9, -74.078, 'ZONA-OTRA'),
        centroAyuda(CENTRO_ID, 4.729, -74.078),
      ],
    });

    expect(started).toBe(true);
    // The backend is the only source of truth: nothing is published on the relay.
    expect(port.published).toHaveLength(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/v1/solicitudes');
    expect(options.method).toBe('POST');
    // The REAL body, never the old placeholders (`REQ-…`, `CA-CRUE`, blank zone).
    expect(JSON.parse(options.body as string)).toEqual({
      emergenciaId: EMERGENCY_ID,
      centroAyudaId: CENTRO_ID,
      zonaId: 'ZONA-SUBA',
      timeoutEn: new Date(5000 + 45_000).toISOString(),
    });

    // The stored identity and state come from the SERVER response, not the local
    // projection.
    const state = useCitizenRequestStore.getState();
    expect(state.phase).toBe('searching');
    expect(state.requestId).toBe(REST_RESPONSE.id);
    expect(state.startedAt).toBe(Date.parse(REST_RESPONSE.solicitadaEn));
    expect(state.notifiedIds).toEqual(REST_RESPONSE.ambulanciasNotificadas);
    expect(state.startError).toBeNull();

    const stored = useSolicitudesStore
      .getState()
      .items.find((item) => item.id === REST_RESPONSE.id);
    expect(stored).toMatchObject({
      estado: 'PENDING',
      zonaId: 'ZONA-SUBA',
      tipo: 'Derrumbe en Suba',
    });
  });

  it('falls back to the chosen center zone when the emergency declares none', async () => {
    fetchMock.mockResolvedValue(mockResponse(201, REST_RESPONSE));

    const started = await useCitizenRequestStore.getState().start({
      port: new FakeRealtimePort(),
      units: MOCK_AMBULANCIAS,
      origin: ORIGIN,
      emergencies: [emergencia({ zonaId: '' })],
      centros: [centroAyuda(CENTRO_ID, 4.729, -74.078, 'ZONA-CENTRO')],
    });

    expect(started).toBe(true);
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(options.body as string).zonaId).toBe('ZONA-CENTRO');
  });

  it('does not send without an active emergency and reports the honest reason', async () => {
    const started = await useCitizenRequestStore.getState().start({
      port: new FakeRealtimePort(),
      units: MOCK_AMBULANCIAS,
      origin: ORIGIN,
      emergencies: [],
      centros: [centroAyuda(CENTRO_ID, 4.729, -74.078, 'ZONA-SUBA')],
    });

    expect(started).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useCitizenRequestStore.getState().phase).toBe('idle');
    expect(useCitizenRequestStore.getState().startError).toBe(CITIZEN_REQUEST_REASONS.noEmergency);
  });

  it('does not send with no usable zone and reports the honest reason', async () => {
    const started = await useCitizenRequestStore.getState().start({
      port: new FakeRealtimePort(),
      units: MOCK_AMBULANCIAS,
      origin: ORIGIN,
      emergencies: [emergencia({ zonaId: '' })],
      centros: [centroAyuda(CENTRO_ID, 4.729, -74.078)],
    });

    expect(started).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useCitizenRequestStore.getState().startError).toBe(CITIZEN_REQUEST_REASONS.noZone);
  });

  it('does not send with no center to point at and reports the honest reason', async () => {
    const started = await useCitizenRequestStore.getState().start({
      port: new FakeRealtimePort(),
      units: MOCK_AMBULANCIAS,
      origin: ORIGIN,
      emergencies: [emergencia()],
      centros: [],
    });

    expect(started).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useCitizenRequestStore.getState().startError).toBe(CITIZEN_REQUEST_REASONS.noCenter);
  });

  it('stays idle and surfaces the backend message when the creation is rejected', async () => {
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
      emergencies: [emergencia()],
      centros: [centroAyuda(CENTRO_ID, 4.729, -74.078, 'ZONA-SUBA')],
    });

    expect(started).toBe(false);
    expect(useCitizenRequestStore.getState().phase).toBe('idle');
    expect(useCitizenRequestStore.getState().requestId).toBeNull();
    expect(port.published).toHaveLength(0);
    expect(useCitizenRequestStore.getState().startError).toBe(
      'No hay ambulancias disponibles para atender la solicitud.',
    );
  });

  it('drops a malformed response instead of storing a half request', async () => {
    fetchMock.mockResolvedValue(mockResponse(201, { ok: true }));

    const started = await useCitizenRequestStore.getState().start({
      port: new FakeRealtimePort(),
      units: MOCK_AMBULANCIAS,
      origin: ORIGIN,
      emergencies: [emergencia()],
      centros: [centroAyuda(CENTRO_ID, 4.729, -74.078, 'ZONA-SUBA')],
    });

    expect(started).toBe(false);
    expect(useCitizenRequestStore.getState().phase).toBe('idle');
    expect(useCitizenRequestStore.getState().requestId).toBeNull();
    expect(useCitizenRequestStore.getState().startError).toBe(
      'El servidor devolvió una solicitud con una forma inesperada.',
    );
  });
});
