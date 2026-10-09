import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToastStore } from '@/components/ui/toast';
import { useSolicitudesStore } from '@/features/solicitudes/solicitudes-store';
import { useSessionStore } from '@/features/usuarios/session';
import { SESSION_CHANGED_MESSAGE } from '@/features/usuarios/session-sync';
import { MOCK_AMBULANCIAS } from '@/mocks/fixtures';
import { setSession, setToken } from '@/services/apiClient';
import { DESTINATIONS } from '@/shared/realtime';
import { FakeRealtimePort } from '@/test/fake-realtime-port';
import type { AmbulanceState, Ambulancia } from '@/types/domain';
import {
  buildCitizenBroadcast,
  CITIZEN_REQUEST_LABEL,
  CITIZEN_REQUEST_REASONS,
  citizenSceneLabel,
  countAvailableUnits,
  formatUnitList,
  isUuid,
  nearestAvailableUnits,
  searchElapsed,
  searchIntroText,
} from './citizen-request';
import {
  syncCitizenRequest,
  useCitizenRequestStore,
  useCitizenRequestSync,
} from './citizen-request-store';

/** Origin used by the page as the pickup point (Suba). */
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

describe('isUuid', () => {
  it('accepts a canonical 36-char UUID, any version', () => {
    expect(isUuid('0b6f2f0e-1111-4000-8000-0000000000aa')).toBe(true);
    expect(isUuid('8B6F2F0E-0000-4000-8000-000000000101')).toBe(true);
  });

  it('rejects the fixture ids that caused the raw 400', () => {
    // `EMG-002` is what reached POST /solicitudes before this guard; `CA-CRUE`
    // and a local `REQ-…` are the same class of non-server id.
    expect(isUuid('EMG-002')).toBe(false);
    expect(isUuid('CA-CRUE')).toBe(false);
    expect(isUuid('REQ-ABC123')).toBe(false);
    expect(isUuid('')).toBe(false);
    // A near-miss must not pass: wrong length, a non-hex char, missing segments.
    expect(isUuid('0b6f2f0e-1111-4000-8000-0000000000')).toBe(false);
    expect(isUuid('0b6f2f0e-1111-4000-8000-0000000000zz')).toBe(false);
  });
});

describe('buildCitizenBroadcast', () => {
  it('alerts every available unit and keeps the real pickup point', () => {
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

  it('does not enter a search without a pickup point and reports the honest reason', async () => {
    const port = new FakeRealtimePort();

    const started = await useCitizenRequestStore.getState().start({
      port,
      units: MOCK_AMBULANCIAS,
      origin: null,
    });

    expect(started).toBe(false);
    expect(useCitizenRequestStore.getState().phase).toBe('idle');
    expect(useCitizenRequestStore.getState().startError).toBe(CITIZEN_REQUEST_REASONS.noLocation);
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

  it('closes an accepted request on the backend TOMADA without inventing a confirmation', () => {
    useCitizenRequestStore
      .getState()
      .start({ port: new FakeRealtimePort(), units: MOCK_AMBULANCIAS, origin: ORIGIN });
    const requestId = useCitizenRequestStore.getState().requestId ?? '';
    useCitizenRequestStore.getState().endOnTaken(requestId, 'A-12');

    useCitizenRequestStore.getState().endOnClosed(requestId);

    expect(useCitizenRequestStore.getState().phase).toBe('closed');
    // The citizen never confirmed: the close must not fabricate an instant.
    expect(useCitizenRequestStore.getState().confirmedAt).toBeNull();
  });

  it('expires the search on the backend TIMEOUT, only for OUR request', () => {
    useCitizenRequestStore
      .getState()
      .start({ port: new FakeRealtimePort(), units: MOCK_AMBULANCIAS, origin: ORIGIN });
    const requestId = useCitizenRequestStore.getState().requestId ?? '';

    // Another request's expiry never affects ours.
    useCitizenRequestStore.getState().endOnExpired('REQ-OTHER');
    expect(useCitizenRequestStore.getState().phase).toBe('searching');

    useCitizenRequestStore.getState().endOnExpired(requestId);
    expect(useCitizenRequestStore.getState().phase).toBe('expired');
  });
});

/** A server-shaped 201 body: a standalone request, no emergency/center/zone. */
const REST_RESPONSE = {
  id: '8b6f2f0e-0000-4000-8000-000000000042',
  ubicacion: { lat: 4.728, lng: -74.078 },
  emergenciaId: null,
  estado: 'PENDIENTE',
  centroAyudaId: null,
  zonaId: null,
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
    useSessionStore.setState({ user: null, role: null, token: null });
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    useCitizenRequestStore.getState().reset();
    useSolicitudesStore.getState().hydrate([]);
    useToastStore.setState({ toasts: [] });
    useSessionStore.setState({ user: null, role: null, token: null });
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('sends only the pickup point, with no emergency, center or zone', async () => {
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
    // Asking for an ambulance no longer depends on an affected zone: the body is
    // only the pickup point. The deadline is the server's (EP-04.F2.US6).
    expect(JSON.parse(options.body as string)).toEqual({
      ubicacion: ORIGIN,
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
      ubicacion: ORIGIN,
      tipo: CITIZEN_REQUEST_LABEL,
    });
    // A standalone request carries no emergency id: the mapper never invents one.
    expect(stored?.emergenciaId).toBe('');
  });

  it('does not send without a pickup point and reports the honest reason', async () => {
    const started = await useCitizenRequestStore.getState().start({
      port: new FakeRealtimePort(),
      units: MOCK_AMBULANCIAS,
      origin: null,
    });

    expect(started).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useCitizenRequestStore.getState().phase).toBe('idle');
    expect(useCitizenRequestStore.getState().startError).toBe(CITIZEN_REQUEST_REASONS.noLocation);
  });

  it('does not send with a foreign persisted token and reports the session change honestly', async () => {
    // The bug: another tab signed in, so storage holds a token that is not this
    // screen's. The in-memory citizen session is still mounted.
    useSessionStore.setState({
      user: {
        id: 'usr-citizen',
        nombre: 'Ana Gómez',
        email: 'ciudadano@nexovital.co',
        rol: 'CIUDADANO',
      },
      role: 'CIUDADANO',
      token: 'jwt.citizen',
    });
    setToken('jwt.admin');
    setSession({
      id: 'usr-admin',
      nombre: 'Andrés Rangel',
      email: 'rangel@nexovital.co',
      rol: 'ADMIN_CENTRO_AYUDA',
    });

    const started = await useCitizenRequestStore.getState().start({
      port: new FakeRealtimePort(),
      units: MOCK_AMBULANCIAS,
      origin: ORIGIN,
    });

    expect(started).toBe(false);
    // The request never reaches the backend with the foreign token.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useCitizenRequestStore.getState().phase).toBe('idle');
    expect(useCitizenRequestStore.getState().startError).toBe(SESSION_CHANGED_MESSAGE);
    // The misleading backend permission text is nowhere near this path.
    expect(useCitizenRequestStore.getState().startError).not.toContain('No tiene permisos');
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
    });

    expect(started).toBe(false);
    expect(useCitizenRequestStore.getState().phase).toBe('idle');
    expect(useCitizenRequestStore.getState().requestId).toBeNull();
    expect(useCitizenRequestStore.getState().startError).toBe(
      'El servidor devolvió una solicitud con una forma inesperada.',
    );
  });

  it('confirms the arrival through REST, adopts the server close and never publishes', async () => {
    const port = new FakeRealtimePort();
    fetchMock.mockResolvedValueOnce(mockResponse(201, REST_RESPONSE));
    await useCitizenRequestStore.getState().start({
      port,
      units: MOCK_AMBULANCIAS,
      origin: ORIGIN,
    });
    const requestId = REST_RESPONSE.id;
    const winner = '8b6f2f0e-0000-4000-8000-0000000000a2';
    useCitizenRequestStore.getState().endOnTaken(requestId, winner);
    useCitizenRequestStore.getState().applyArrived(requestId);
    expect(useCitizenRequestStore.getState().phase).toBe('arrived');

    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(
      mockResponse(200, {
        ...REST_RESPONSE,
        estado: 'CONFIRMADA',
        ambulanciaAsignadaId: winner,
      }),
    );

    useCitizenRequestStore.getState().confirmArrival(port);

    await vi.waitFor(() => {
      expect(useCitizenRequestStore.getState().phase).toBe('closed');
    });

    const [path, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/api/v1/solicitudes/${requestId}/confirmar`);
    expect(options.method).toBe('POST');
    // The controller takes no body: nothing is sent.
    expect(options.body).toBeUndefined();
    // Off-demo nothing is published on the relay.
    expect(port.published).toHaveLength(0);
    expect(useSolicitudesStore.getState().items.find((item) => item.id === requestId)?.estado).toBe(
      'CONFIRMED',
    );
  });

  it('does not fail silently when the backend refuses the confirmation', async () => {
    const port = new FakeRealtimePort();
    fetchMock.mockResolvedValueOnce(mockResponse(201, REST_RESPONSE));
    await useCitizenRequestStore.getState().start({
      port,
      units: MOCK_AMBULANCIAS,
      origin: ORIGIN,
    });
    const requestId = REST_RESPONSE.id;
    useCitizenRequestStore.getState().endOnTaken(requestId, 'winner');
    useCitizenRequestStore.getState().applyArrived(requestId);

    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(
      mockResponse(409, {
        codigo: 'SOLICITUD_NO_ASIGNABLE',
        mensaje: 'La solicitud ya no admite esa transición.',
      }),
    );

    useCitizenRequestStore.getState().confirmArrival(port);

    await vi.waitFor(() => {
      expect(useToastStore.getState().toasts).toHaveLength(1);
    });
    expect(useToastStore.getState().toasts[0].message).toBe(
      'La solicitud ya no admite esa transición.',
    );
    // The failure changed nothing: the request stays open for a retry.
    expect(useCitizenRequestStore.getState().phase).toBe('arrived');
  });

  it('cancels the open request through REST, adopts the server close and never publishes', async () => {
    const port = new FakeRealtimePort();
    fetchMock.mockResolvedValueOnce(mockResponse(201, REST_RESPONSE));
    await useCitizenRequestStore.getState().start({
      port,
      units: MOCK_AMBULANCIAS,
      origin: ORIGIN,
    });
    expect(useCitizenRequestStore.getState().phase).toBe('searching');

    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(mockResponse(200, { ...REST_RESPONSE, estado: 'CANCELADA' }));

    await useCitizenRequestStore.getState().cancel(port);

    const [path, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/api/v1/solicitudes/${REST_RESPONSE.id}/cancelar`);
    expect(options.method).toBe('POST');
    // The controller takes no body: nothing is sent beyond the bearer.
    expect(options.body).toBeUndefined();
    // Off-demo nothing is published on the relay.
    expect(port.published).toHaveLength(0);
    expect(useCitizenRequestStore.getState().phase).toBe('idle');
    expect(useCitizenRequestStore.getState().requestId).toBeNull();
    expect(useCitizenRequestStore.getState().cancelError).toBeNull();
  });

  it('does not fake a cancellation when the backend refuses it: keeps the state and shows the reason', async () => {
    const port = new FakeRealtimePort();
    fetchMock.mockResolvedValueOnce(mockResponse(201, REST_RESPONSE));
    await useCitizenRequestStore.getState().start({
      port,
      units: MOCK_AMBULANCIAS,
      origin: ORIGIN,
    });
    const requestId = REST_RESPONSE.id;
    // A unit already accepted: the ambulance is on its way.
    useCitizenRequestStore.getState().endOnTaken(requestId, 'winner');
    expect(useCitizenRequestStore.getState().phase).toBe('accepted');

    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(
      mockResponse(409, {
        codigo: 'SOLICITUD_NO_ASIGNABLE',
        mensaje: 'La solicitud ya no admite esa transición.',
      }),
    );

    await useCitizenRequestStore.getState().cancel(port);

    // The citizen keeps seeing the REAL state; the backend reason is surfaced and
    // the request is not cleared as if it had been cancelled.
    expect(useCitizenRequestStore.getState().phase).toBe('accepted');
    expect(useCitizenRequestStore.getState().requestId).toBe(requestId);
    expect(useCitizenRequestStore.getState().cancelError).toBe(
      'La solicitud ya no admite esa transición.',
    );
    await vi.waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
  });
});

describe('useCitizenRequestStore restored from the server (EP-04.F2.US9)', () => {
  const fetchMock = vi.fn();
  const ARRIVED_AT = '2026-01-01T00:10:00.000Z';
  const ASSIGNED = {
    ...REST_RESPONSE,
    estado: 'ASIGNADA',
    ambulanciaAsignadaId: 'A-07',
  };

  beforeEach(() => {
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

  it('after a reload, an arrived request comes back as arrived with the server time', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, [{ ...ASSIGNED, llegadaEn: ARRIVED_AT }]));

    syncCitizenRequest();

    await vi.waitFor(() => expect(useCitizenRequestStore.getState().phase).toBe('arrived'));
    const state = useCitizenRequestStore.getState();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/solicitudes/mias');
    expect(state.requestId).toBe(REST_RESPONSE.id);
    expect(state.acceptedBy).toBe('A-07');
    expect(state.arrivedAt).toBe(Date.parse(ARRIVED_AT));
    expect(state.startedAt).toBe(Date.parse(REST_RESPONSE.solicitadaEn));
  });

  it('maps a pending request to searching and a confirmed one to closed', () => {
    const store = useCitizenRequestStore.getState();
    store.restoreFromServer([
      {
        id: 'R-1',
        emergenciaId: '',
        centroAyudaId: '',
        zonaId: '',
        tipo: '',
        estado: 'PENDING',
        solicitadaEn: REST_RESPONSE.solicitadaEn,
        timeoutEn: REST_RESPONSE.timeoutEn,
        ambulanciasNotificadas: ['A-07'],
        notifiedCount: 1,
      },
    ]);
    expect(useCitizenRequestStore.getState().phase).toBe('searching');

    useCitizenRequestStore.getState().reset();
    useCitizenRequestStore.getState().restoreFromServer([
      {
        id: 'R-2',
        emergenciaId: '',
        centroAyudaId: '',
        zonaId: '',
        tipo: '',
        estado: 'CONFIRMED',
        solicitadaEn: REST_RESPONSE.solicitadaEn,
        timeoutEn: REST_RESPONSE.timeoutEn,
        ambulanciasNotificadas: ['A-07'],
        notifiedCount: 1,
        ambulanciaAsignadaId: 'A-07',
        llegadaEn: ARRIVED_AT,
      },
    ]);
    expect(useCitizenRequestStore.getState()).toMatchObject({
      phase: 'closed',
      requestId: 'R-2',
      arrivedAt: Date.parse(ARRIVED_AT),
    });
  });

  it('never moves our request backwards and keeps a local open request the server does not list', () => {
    useCitizenRequestStore.setState({
      phase: 'arrived',
      requestId: REST_RESPONSE.id,
      acceptedBy: 'A-07',
      arrivedAt: 1,
    });
    useCitizenRequestStore.getState().restoreFromServer([
      {
        id: REST_RESPONSE.id,
        emergenciaId: '',
        centroAyudaId: '',
        zonaId: '',
        tipo: '',
        estado: 'ASSIGNED',
        solicitadaEn: REST_RESPONSE.solicitadaEn,
        timeoutEn: REST_RESPONSE.timeoutEn,
        ambulanciasNotificadas: ['A-07'],
        notifiedCount: 1,
        ambulanciaAsignadaId: 'A-07',
      },
    ]);
    expect(useCitizenRequestStore.getState().phase).toBe('arrived');

    useCitizenRequestStore.setState({ phase: 'searching', requestId: 'LOCAL-1' });
    useCitizenRequestStore.getState().restoreFromServer([
      {
        id: 'OTHER',
        emergenciaId: '',
        centroAyudaId: '',
        zonaId: '',
        tipo: '',
        estado: 'PENDING',
        solicitadaEn: REST_RESPONSE.solicitadaEn,
        timeoutEn: REST_RESPONSE.timeoutEn,
        ambulanciasNotificadas: [],
        notifiedCount: 0,
      },
    ]);
    expect(useCitizenRequestStore.getState().requestId).toBe('LOCAL-1');
  });

  it('on the arrival push it rereads the request and shows the time the server recorded', async () => {
    useCitizenRequestStore.setState({
      phase: 'accepted',
      requestId: REST_RESPONSE.id,
      acceptedBy: 'A-07',
      acceptedAt: 1,
    });
    fetchMock.mockResolvedValue(mockResponse(200, [{ ...ASSIGNED, llegadaEn: ARRIVED_AT }]));
    const port = new FakeRealtimePort();
    renderHook(() => useCitizenRequestSync(port));

    port.emit(DESTINATIONS.solicitudes, { type: 'request.arrived', requestId: REST_RESPONSE.id });

    expect(useCitizenRequestStore.getState().phase).toBe('arrived');
    await vi.waitFor(() =>
      expect(useCitizenRequestStore.getState().arrivedAt).toBe(Date.parse(ARRIVED_AT)),
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/solicitudes/mias');
  });
});
