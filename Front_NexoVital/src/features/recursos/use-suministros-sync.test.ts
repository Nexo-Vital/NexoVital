import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DESTINATIONS } from '@/shared/realtime';
import { FakeRealtimePort } from '@/test/fake-realtime-port';
import { useInventarioStore } from './inventory-store';
import { useSuministrosSync } from './use-suministros-sync';

const CENTRO_ID = '22222222-2222-4222-8222-222222222222';

/** A wire item exactly as `/topic/suministros` publishes it (Spanish semaforo). */
function wire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    centroAcopioId: CENTRO_ID,
    nombre: 'Agua potable',
    disponible: 12,
    requerido: 60,
    semaforo: 'ROJO',
    ...overrides,
  };
}

function items() {
  return useInventarioStore.getState().itemsByCentro[CENTRO_ID] ?? [];
}

describe('useSuministrosSync', () => {
  beforeEach(() => useInventarioStore.getState().reset());
  afterEach(cleanup);

  it('UPSERTs a bare item frame published on /topic/suministros', () => {
    const port = new FakeRealtimePort();
    renderHook(() => useSuministrosSync(port));

    act(() => port.emit(DESTINATIONS.suministros, wire()));

    expect(items()).toHaveLength(1);
    expect(items()[0]).toMatchObject({ id: wire().id, semaforo: 'RED' });
  });

  it('merges an update by id instead of duplicating the item', () => {
    const port = new FakeRealtimePort();
    renderHook(() => useSuministrosSync(port));

    act(() => port.emit(DESTINATIONS.suministros, wire()));
    act(() => port.emit(DESTINATIONS.suministros, wire({ disponible: 52, semaforo: 'VERDE' })));

    expect(items()).toHaveLength(1);
    expect(items()[0]).toMatchObject({ disponible: 52, semaforo: 'GREEN' });
  });

  it('ignores malformed frames', () => {
    const port = new FakeRealtimePort();
    renderHook(() => useSuministrosSync(port));

    act(() => port.emit(DESTINATIONS.suministros, { semaforo: 'ROJO' }));
    act(() => port.emit(DESTINATIONS.suministros, null));

    expect(items()).toEqual([]);
  });

  it('notifies the caller once per accepted item, so it can re-read dependent projections', () => {
    const port = new FakeRealtimePort();
    const onUpsert = vi.fn();
    renderHook(() => useSuministrosSync(port, onUpsert));

    act(() => port.emit(DESTINATIONS.suministros, wire()));
    expect(onUpsert).toHaveBeenCalledTimes(1);

    // A malformed frame changes no inventory, so it must not trigger a re-read.
    act(() => port.emit(DESTINATIONS.suministros, { semaforo: 'ROJO' }));
    expect(onUpsert).toHaveBeenCalledTimes(1);
  });
});
