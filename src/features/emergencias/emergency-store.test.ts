import { beforeEach, describe, expect, it } from 'vitest';
import { MOCK_EMERGENCIAS } from '@/mocks/fixtures';
import { useEmergencyStore } from './emergency-store';

function reset() {
  useEmergencyStore.setState({ items: [] });
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
});
