import { beforeEach, describe, expect, it } from 'vitest';
import type { Ambulancia } from '@/types/domain';
import { useFleetStore } from './fleet-store';

const UNIT: Ambulancia = {
  id: 'AMB-11',
  placa: 'TBD',
  estado: 'AVAILABLE',
  ubicacion: { lat: 4.6, lng: -74.1 },
  zona: 'Unassigned',
  driverName: 'New Driver',
};

function reset() {
  useFleetStore.setState({ units: [] });
}

describe('fleet-store', () => {
  beforeEach(reset);

  it('upsert creates a unit that does not exist locally', () => {
    useFleetStore.getState().upsert(UNIT);

    expect(useFleetStore.getState().units.map((item) => item.id)).toEqual(['AMB-11']);
  });

  it('upsert merges an existing unit in place', () => {
    useFleetStore.getState().hydrate([{ ...UNIT, driverName: 'Old Name' }]);

    useFleetStore.getState().upsert({ ...UNIT, driverName: 'New Name', estado: 'EN_ROUTE' });

    const units = useFleetStore.getState().units;
    expect(units).toHaveLength(1);
    expect(units[0]?.driverName).toBe('New Name');
    expect(units[0]?.estado).toBe('EN_ROUTE');
  });

  it('remove deletes by id', () => {
    useFleetStore.getState().hydrate([UNIT]);

    useFleetStore.getState().remove('AMB-11');

    expect(useFleetStore.getState().units).toHaveLength(0);
  });

  it('hydrate replaces the whole fleet', () => {
    useFleetStore.getState().hydrate([UNIT]);
    useFleetStore.getState().hydrate([]);

    expect(useFleetStore.getState().units).toHaveLength(0);
  });
});
