import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DESTINATIONS } from '@/shared/realtime';
import { FakeRealtimePort } from '@/test/fake-realtime-port';
import type { Emergencia } from '@/types/domain';
import { useEmergencyStore } from './emergency-store';
import { useEmergencySync } from './use-emergency-sync';

const NEW_EMERGENCY: Emergencia = {
  id: 'EMG-099',
  ubicacion: { lat: 4.6, lng: -74.1 },
  nivel: 'CRITICAL',
  estado: 'REPORTED',
  descripcion: 'Reported from another client',
  zonaId: 'Centro',
  createdAt: new Date().toISOString(),
};

function items() {
  return useEmergencyStore.getState().items;
}

describe('useEmergencySync', () => {
  beforeEach(() => useEmergencyStore.setState({ items: [] }));
  afterEach(cleanup);

  it('UPSERTS a reported emergency from another client', () => {
    const port = new FakeRealtimePort();
    renderHook(() => useEmergencySync(port));

    act(() =>
      port.emit(DESTINATIONS.emergencias, {
        type: 'emergency.upsert',
        emergency: NEW_EMERGENCY,
      }),
    );

    expect(items().map((item) => item.id)).toEqual(['EMG-099']);
  });

  it('accepts a bare emergency object for backward compatibility', () => {
    const port = new FakeRealtimePort();
    renderHook(() => useEmergencySync(port));

    act(() => port.emit(DESTINATIONS.emergencias, NEW_EMERGENCY));

    expect(items()).toHaveLength(1);
  });

  it('merges an update onto an existing emergency', () => {
    useEmergencyStore.setState({ items: [NEW_EMERGENCY] });
    const port = new FakeRealtimePort();
    renderHook(() => useEmergencySync(port));

    act(() =>
      port.emit(DESTINATIONS.emergencias, {
        type: 'emergency.upsert',
        emergency: { ...NEW_EMERGENCY, estado: 'RESOLVED' },
      }),
    );

    expect(items()).toHaveLength(1);
    expect(items()[0]?.estado).toBe('RESOLVED');
  });

  it('ignores malformed frames', () => {
    const port = new FakeRealtimePort();
    renderHook(() => useEmergencySync(port));

    act(() => port.emit(DESTINATIONS.emergencias, { type: 'emergency.upsert', emergency: {} }));
    act(() => port.emit(DESTINATIONS.emergencias, null));

    expect(items()).toHaveLength(0);
  });
});
