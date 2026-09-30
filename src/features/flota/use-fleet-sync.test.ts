import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DESTINATIONS } from '@/shared/realtime';
import { FakeRealtimePort } from '@/test/fake-realtime-port';
import type { Ambulancia } from '@/types/domain';
import { useFleetStore } from './fleet-store';
import { useFleetSync } from './use-fleet-sync';

const NEW_UNIT: Ambulancia = {
  id: 'AMB-11',
  placa: 'TBD',
  estado: 'AVAILABLE',
  ubicacion: { lat: 4.65, lng: -74.06 },
  zona: 'Unassigned',
  driverName: 'Remote Driver',
};

function units() {
  return useFleetStore.getState().units;
}

describe('useFleetSync', () => {
  beforeEach(() => useFleetStore.setState({ units: [] }));
  afterEach(cleanup);

  it('UPSERTS a unit created on another client (id not in local fixtures)', () => {
    const port = new FakeRealtimePort();
    renderHook(() => useFleetSync(port));

    act(() => port.emit(DESTINATIONS.flota, { type: 'fleet.upsert', unit: NEW_UNIT }));

    expect(units().map((item) => item.id)).toEqual(['AMB-11']);
  });

  it('merges a live position frame onto an existing unit', () => {
    useFleetStore.setState({ units: [NEW_UNIT] });
    const port = new FakeRealtimePort();
    renderHook(() => useFleetSync(port));

    act(() =>
      port.emit(DESTINATIONS.flota, {
        ambulanceId: 'AMB-11',
        ubicacion: { lat: 4.7, lng: -74.05 },
        estado: 'EN_ROUTE',
        heading: 90,
        source: 'device',
      }),
    );

    const unit = units()[0];
    expect(unit?.ubicacion).toEqual({ lat: 4.7, lng: -74.05 });
    expect(unit?.estado).toBe('EN_ROUTE');
    expect(unit?.source).toBe('device');
  });

  it('creates a unit from a live position frame when it is unknown', () => {
    const port = new FakeRealtimePort();
    renderHook(() => useFleetSync(port));

    act(() =>
      port.emit(DESTINATIONS.flota, {
        ambulanceId: 'AMB-99',
        ubicacion: { lat: 4.61, lng: -74.08 },
        estado: 'AVAILABLE',
        heading: null,
        source: 'simulated',
      }),
    );

    expect(units().map((item) => item.id)).toEqual(['AMB-99']);
    // The frame carries no plate, so a unit first seen here keeps an EMPTY plate
    // (the honest unknown) instead of an invented 'TBD'.
    expect(units()[0]?.placa).toBe('');
  });

  it('applies a state-only frame (Spanish enum, no position) to a known unit', () => {
    useFleetStore.setState({ units: [NEW_UNIT] });
    const port = new FakeRealtimePort();
    renderHook(() => useFleetSync(port));

    // The backend's `FlotaActualizadaEvent` frame: `ambulanciaId` + Spanish
    // enum, no `ubicacion`. Assignment must flip the unit to ASSIGNED.
    act(() => port.emit(DESTINATIONS.flota, { ambulanciaId: 'AMB-11', estado: 'EN_MISION' }));

    const unit = units()[0];
    expect(unit?.estado).toBe('ASSIGNED');
    // The state change carries no position, so the known one is preserved.
    expect(unit?.ubicacion).toEqual(NEW_UNIT.ubicacion);
  });

  it('ignores a state-only frame for an unknown unit (nothing to anchor)', () => {
    const port = new FakeRealtimePort();
    renderHook(() => useFleetSync(port));

    act(() => port.emit(DESTINATIONS.flota, { ambulanciaId: 'AMB-77', estado: 'EN_MISION' }));

    expect(units()).toHaveLength(0);
  });

  it('removes a unit on fleet.delete', () => {
    useFleetStore.setState({ units: [NEW_UNIT] });
    const port = new FakeRealtimePort();
    renderHook(() => useFleetSync(port));

    act(() => port.emit(DESTINATIONS.flota, { type: 'fleet.delete', ambulanceId: 'AMB-11' }));

    expect(units()).toHaveLength(0);
  });

  it('ignores malformed frames', () => {
    const port = new FakeRealtimePort();
    renderHook(() => useFleetSync(port));

    act(() => port.emit(DESTINATIONS.flota, { type: 'fleet.upsert', unit: { id: 5 } }));
    act(() => port.emit(DESTINATIONS.flota, null));

    expect(units()).toHaveLength(0);
  });
});
