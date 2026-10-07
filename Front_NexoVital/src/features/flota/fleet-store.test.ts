import { beforeEach, describe, expect, it } from 'vitest';
import type { Ambulancia } from '@/types/domain';
import { isStaleVersion, useFleetStore } from './fleet-store';

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

describe('isStaleVersion (EP-04.F1.US1, D6)', () => {
  it('is stale only when the incoming version is strictly lower', () => {
    expect(isStaleVersion(5, 4)).toBe(true);
    // The state frame and the position frame of one write share the version.
    expect(isStaleVersion(5, 5)).toBe(false);
    expect(isStaleVersion(5, 6)).toBe(false);
  });

  it('never calls stale a side that carries no version', () => {
    expect(isStaleVersion(undefined, 1)).toBe(false);
    expect(isStaleVersion(5, undefined)).toBe(false);
    expect(isStaleVersion(undefined, undefined)).toBe(false);
  });
});

describe('fleet-store: snapshot merge by version (EP-04.F1.US1, D6)', () => {
  beforeEach(reset);

  it('keeps the live fields of a unit held at a NEWER version than the snapshot', () => {
    // A frame (version 9) landed while the REST read (version 8) was on its way.
    useFleetStore.setState({
      units: [
        {
          ...UNIT,
          placa: '',
          estado: 'ASSIGNED',
          ubicacion: { lat: 4.7, lng: -74.05 },
          sinSenal: false,
          version: 9,
        },
      ],
    });

    useFleetStore
      .getState()
      .hydrate([{ ...UNIT, placa: 'ABC101', zona: 'Suba', sinSenal: true, version: 8 }]);

    const unit = useFleetStore.getState().units[0];
    // The newer write wins for everything a frame can change...
    expect(unit?.ubicacion).toEqual({ lat: 4.7, lng: -74.05 });
    expect(unit?.estado).toBe('ASSIGNED');
    expect(unit?.sinSenal).toBe(false);
    expect(unit?.version).toBe(9);
    // ...and the snapshot still gives the identity a frame never carries.
    expect(unit?.placa).toBe('ABC101');
    expect(unit?.zona).toBe('Suba');
  });

  it('takes the snapshot when it is as new as, or newer than, the held unit', () => {
    useFleetStore.setState({ units: [{ ...UNIT, sinSenal: true, version: 8 }] });

    useFleetStore
      .getState()
      .hydrate([{ ...UNIT, ubicacion: { lat: 4.9, lng: -74.0 }, sinSenal: false, version: 9 }]);

    const unit = useFleetStore.getState().units[0];
    expect(unit?.ubicacion).toEqual({ lat: 4.9, lng: -74.0 });
    expect(unit?.sinSenal).toBe(false);
    expect(unit?.version).toBe(9);
  });

  it('takes the snapshot when either side has no version', () => {
    useFleetStore.setState({ units: [{ ...UNIT, estado: 'ASSIGNED' }] });

    useFleetStore.getState().hydrate([{ ...UNIT, estado: 'AVAILABLE', version: 1 }]);

    expect(useFleetStore.getState().units[0]?.estado).toBe('AVAILABLE');
  });

  it('lets the snapshot decide which units exist', () => {
    useFleetStore.setState({ units: [{ ...UNIT, version: 9 }] });

    useFleetStore.getState().hydrate([{ ...UNIT, id: 'AMB-12', version: 1 }]);

    expect(useFleetStore.getState().units.map((item) => item.id)).toEqual(['AMB-12']);
  });

  it('forgetVersions drops every version and keeps the rest of the unit', () => {
    useFleetStore.setState({ units: [{ ...UNIT, sinSenal: true, version: 9 }] });

    useFleetStore.getState().forgetVersions();

    const unit = useFleetStore.getState().units[0];
    expect(unit?.version).toBeUndefined();
    expect(unit?.sinSenal).toBe(true);
    expect(unit?.ubicacion).toEqual(UNIT.ubicacion);
  });

  it('after forgetVersions an older snapshot wins again (backend restarted from zero)', () => {
    useFleetStore.setState({ units: [{ ...UNIT, estado: 'ASSIGNED', version: 900 }] });
    useFleetStore.getState().forgetVersions();

    useFleetStore.getState().hydrate([{ ...UNIT, estado: 'AVAILABLE', version: 1 }]);

    const unit = useFleetStore.getState().units[0];
    expect(unit?.estado).toBe('AVAILABLE');
    expect(unit?.version).toBe(1);
  });
});
