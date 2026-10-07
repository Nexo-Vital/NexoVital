import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToastStore } from '@/components/ui/toast';
import { useEmergencyStore } from '@/features/emergencias/emergency-store';
import { FakeRealtimePort } from '@/test/fake-realtime-port';
import type { SolicitudAmbulancia } from '@/types/domain';
import { useSolicitudInbox } from './use-solicitud-inbox';

/**
 * EP-04.F2.US1, D6: what the push did not deliver is read from the server and
 * handed to the inbox. `offerPending` opens the same card a live frame opens;
 * `restoreMission` reopens a mission the unit already holds on the server.
 */

const UNIT = '8b6f2f0e-0000-4000-8000-0000000000a1';
const OTHER_UNIT = '8b6f2f0e-0000-4000-8000-0000000000a2';
const REQUEST = '8b6f2f0e-0000-4000-8000-0000000000c1';

function solicitud(overrides: Partial<SolicitudAmbulancia> = {}): SolicitudAmbulancia {
  const now = Date.now();
  return {
    id: REQUEST,
    emergenciaId: '',
    estado: 'PENDING',
    centroAyudaId: '',
    zonaId: '',
    ubicacion: { lat: 4.75, lng: -74.09 },
    tipo: '',
    solicitadaEn: new Date(now - 20_000).toISOString(),
    timeoutEn: new Date(now + 40_000).toISOString(),
    ambulanciasNotificadas: [UNIT, OTHER_UNIT],
    notifiedCount: 2,
    ambulanciaAsignadaId: null,
    ...overrides,
  };
}

function setup(online = true) {
  const port = new FakeRealtimePort();
  const view = renderHook(
    ({ connected }: { connected: boolean }) =>
      useSolicitudInbox(port, UNIT, { lat: 4.74, lng: -74.1 }, connected),
    { initialProps: { connected: online } },
  );
  return { port, ...view };
}

describe('useSolicitudInbox: requests read back from the server', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_DEMO_MODE', '0');
  });

  afterEach(() => {
    cleanup();
    useToastStore.setState({ toasts: [] });
    useEmergencyStore.setState({ items: [] });
    vi.unstubAllEnvs();
  });

  it('offerPending opens the request card with the time that is really left', () => {
    const { result } = setup();
    const pendiente = solicitud();

    act(() => result.current.offerPending(pendiente));

    expect(result.current.broadcast?.requestId).toBe(REQUEST);
    expect(result.current.broadcast?.escena).toEqual({ lat: 4.75, lng: -74.09 });
    expect(result.current.broadcast?.notificadas).toEqual([UNIT, OTHER_UNIT]);
    expect(result.current.phase).toBe('idle');
    // The deadline is the server's, not a fresh default window.
    expect(result.current.deadlineMs).toBe(Date.parse(pendiente.timeoutEn));
    // And the request is dated when it was raised, not when it was read back.
    expect(result.current.requestedAtMs).toBe(Date.parse(pendiente.solicitadaEn));
  });

  it('offerPending does not restart a request that is already on screen', () => {
    const { result } = setup();
    const pendiente = solicitud();
    act(() => result.current.offerPending(pendiente));
    const toastsAfterFirst = useToastStore.getState().toasts.length;

    act(() => result.current.offerPending(pendiente));

    expect(useToastStore.getState().toasts).toHaveLength(toastsAfterFirst);
    expect(result.current.broadcast?.requestId).toBe(REQUEST);
  });

  it('offerPending ignores a request whose window is already over', () => {
    const { result } = setup();

    act(() =>
      result.current.offerPending(
        solicitud({ timeoutEn: new Date(Date.now() - 1_000).toISOString() }),
      ),
    );

    expect(result.current.broadcast).toBeNull();
  });

  it('offerPending does not offer again a request this unit declined (EP-04.F2.US5)', () => {
    const { result } = setup();

    // Read back after a reload: still PENDING for the rest, declined by this unit.
    act(() => result.current.offerPending(solicitud({ ambulanciasRechazaron: [UNIT] })));

    expect(result.current.broadcast).toBeNull();
    expect(result.current.queuedIds).toEqual([]);
  });

  it('offerPending still offers a request only ANOTHER unit declined', () => {
    const { result } = setup();

    act(() => result.current.offerPending(solicitud({ ambulanciasRechazaron: [OTHER_UNIT] })));

    expect(result.current.broadcast?.requestId).toBe(REQUEST);
  });

  it('offerPending ignores a request that is no longer pending', () => {
    const { result } = setup();

    act(() => result.current.offerPending(solicitud({ estado: 'TAKEN' })));

    expect(result.current.broadcast).toBeNull();
  });

  it('a request read back while disconnected surfaces when the driver connects', () => {
    const { result, rerender } = setup(false);

    act(() => result.current.offerPending(solicitud()));
    expect(result.current.broadcast).toBeNull();

    rerender({ connected: true });
    expect(result.current.broadcast?.requestId).toBe(REQUEST);
  });

  it('restoreMission reopens the mission the unit holds on the server', () => {
    const { result } = setup();
    const llegadaEn = new Date(Date.now() - 5_000).toISOString();

    act(() =>
      result.current.restoreMission(
        solicitud({ estado: 'ASSIGNED', ambulanciaAsignadaId: UNIT, llegadaEn }),
      ),
    );

    expect(result.current.mission?.requestId).toBe(REQUEST);
    expect(result.current.mission?.escena).toEqual({ lat: 4.75, lng: -74.09 });
    expect(result.current.mission?.arrivedAt).toBe(Date.parse(llegadaEn));
    expect(result.current.missionPhase).toBe('arrived');
    expect(result.current.phase).toBe('assigned');
    // Nothing new happened: no "assigned" notice is raised.
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it('restoreMission keeps a mission without arrival on its way', () => {
    const { result } = setup();

    act(() =>
      result.current.restoreMission(solicitud({ estado: 'ASSIGNED', ambulanciaAsignadaId: UNIT })),
    );

    expect(result.current.mission?.arrivedAt).toBeNull();
    expect(result.current.missionPhase).toBe('en_route');
  });

  it('restoreMission ignores a service assigned to another unit', () => {
    const { result } = setup();

    act(() =>
      result.current.restoreMission(
        solicitud({ estado: 'ASSIGNED', ambulanciaAsignadaId: OTHER_UNIT }),
      ),
    );

    expect(result.current.mission).toBeNull();
  });

  it('restoreMission ignores a service that already finished', () => {
    const { result } = setup();

    act(() =>
      result.current.restoreMission(solicitud({ estado: 'TAKEN', ambulanciaAsignadaId: UNIT })),
    );

    expect(result.current.mission).toBeNull();
  });

  it('restoreMission never overrides a mission that is already open', () => {
    const { result } = setup();
    act(() =>
      result.current.restoreMission(solicitud({ estado: 'ASSIGNED', ambulanciaAsignadaId: UNIT })),
    );

    act(() =>
      result.current.restoreMission(
        solicitud({
          id: '8b6f2f0e-0000-4000-8000-0000000000c2',
          estado: 'ASSIGNED',
          ambulanciaAsignadaId: UNIT,
        }),
      ),
    );

    expect(result.current.mission?.requestId).toBe(REQUEST);
  });
});
