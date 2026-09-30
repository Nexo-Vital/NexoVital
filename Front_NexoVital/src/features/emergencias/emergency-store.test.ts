import { beforeEach, describe, expect, it } from 'vitest';
import { MOCK_EMERGENCIAS } from '@/mocks/fixtures';
import type { Emergencia } from '@/types/domain';
import { useEmergencyStore } from './emergency-store';

function reset() {
  useEmergencyStore.setState({ items: [] });
}

/** A known emergency, with optional overrides such as `version` or `estado`. */
function emergency(overrides: Partial<Emergencia> = {}): Emergencia {
  return {
    id: 'EMG-100',
    ubicacion: { lat: 4.6, lng: -74.1 },
    nivel: 'HIGH',
    estado: 'REPORTED',
    zonaId: 'Centro',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('emergency-store', () => {
  beforeEach(reset);

  it('upsert creates an emergency that does not exist locally', () => {
    const emergency = {
      id: 'EMG-099',
      ubicacion: { lat: 4.6, lng: -74.1 },
      nivel: 'HIGH' as const,
      estado: 'REPORTED' as const,
      zonaId: 'Centro',
      createdAt: new Date().toISOString(),
    };

    useEmergencyStore.getState().upsert(emergency);

    expect(useEmergencyStore.getState().items.map((item) => item.id)).toEqual(['EMG-099']);
  });

  it('upsert merges an existing emergency in place', () => {
    const first = MOCK_EMERGENCIAS[0];
    useEmergencyStore.getState().hydrate([first]);

    useEmergencyStore.getState().upsert({ ...first, estado: 'RESOLVED' });

    expect(useEmergencyStore.getState().items).toHaveLength(1);
    expect(useEmergencyStore.getState().items[0]?.estado).toBe('RESOLVED');
  });

  it('hydrate replaces the list', () => {
    useEmergencyStore.getState().hydrate(MOCK_EMERGENCIAS);

    expect(useEmergencyStore.getState().items).toHaveLength(MOCK_EMERGENCIAS.length);
  });

  // --- Version guard: the reader discards stale realtime frames -----------------

  it('applies an incoming emergency whose version is strictly higher', () => {
    useEmergencyStore.getState().hydrate([emergency({ version: 3, estado: 'REPORTED' })]);

    useEmergencyStore.getState().upsert(emergency({ version: 4, estado: 'IN_PROGRESS' }));

    const [item] = useEmergencyStore.getState().items;
    expect(item?.version).toBe(4);
    expect(item?.estado).toBe('IN_PROGRESS');
  });

  it('discards an older version and leaves the stored state untouched', () => {
    const stored = emergency({ version: 5, estado: 'IN_PROGRESS' });
    useEmergencyStore.getState().hydrate([stored]);
    const itemsBefore = useEmergencyStore.getState().items;

    useEmergencyStore.getState().upsert(emergency({ version: 2, estado: 'CLOSED' }));

    expect(useEmergencyStore.getState().items).toBe(itemsBefore);
    expect(useEmergencyStore.getState().items[0]).toBe(stored);
    expect(useEmergencyStore.getState().items[0]?.estado).toBe('IN_PROGRESS');
  });

  it('discards an equal version (no new information)', () => {
    const stored = emergency({ version: 5, estado: 'IN_PROGRESS' });
    useEmergencyStore.getState().hydrate([stored]);

    useEmergencyStore.getState().upsert(emergency({ version: 5, estado: 'RESOLVED' }));

    expect(useEmergencyStore.getState().items[0]).toBe(stored);
    expect(useEmergencyStore.getState().items[0]?.estado).toBe('IN_PROGRESS');
  });

  it('keeps last-writer-wins when neither side carries a version', () => {
    useEmergencyStore.getState().hydrate([emergency({ estado: 'REPORTED' })]);

    useEmergencyStore.getState().upsert(emergency({ estado: 'RESOLVED' }));

    expect(useEmergencyStore.getState().items[0]?.estado).toBe('RESOLVED');
  });

  it('applies an unversioned event onto a versioned entry (degrades to today)', () => {
    useEmergencyStore.getState().hydrate([emergency({ version: 7, estado: 'REPORTED' })]);

    useEmergencyStore.getState().upsert(emergency({ estado: 'RESOLVED' }));

    expect(useEmergencyStore.getState().items[0]?.estado).toBe('RESOLVED');
  });

  it('applies a versioned event onto an unversioned entry (degrades to today)', () => {
    useEmergencyStore.getState().hydrate([emergency({ estado: 'REPORTED' })]);

    useEmergencyStore.getState().upsert(emergency({ version: 1, estado: 'RESOLVED' }));

    const [item] = useEmergencyStore.getState().items;
    expect(item?.version).toBe(1);
    expect(item?.estado).toBe('RESOLVED');
  });
});
