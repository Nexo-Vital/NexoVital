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

/** A backend position frame (`PosicionPushPayload`) for the known unit. */
function positionFrame(overrides: Record<string, unknown> = {}) {
  return {
    ambulanceId: 'AMB-11',
    ubicacion: { lat: 4.7, lng: -74.05 },
    estado: 'AVAILABLE',
    heading: 90,
    source: 'simulated',
    sinSenal: false,
    ultimaPosicionEn: '2026-10-06T15:00:05Z',
    version: 5,
    ...overrides,
  };
}

describe('useFleetSync: frame order by version (EP-04.F1.US1, D6)', () => {
  beforeEach(() => useFleetStore.setState({ units: [NEW_UNIT] }));
  afterEach(cleanup);

  it('P11: discards a frame older than the one the store already holds', () => {
    const port = new FakeRealtimePort();
    renderHook(() => useFleetSync(port));

    act(() => port.emit(DESTINATIONS.flota, positionFrame({ version: 5 })));
    // The previous write reaches the channel late (pushes leave after commit,
    // each on its own thread).
    act(() =>
      port.emit(
        DESTINATIONS.flota,
        positionFrame({ ubicacion: { lat: 4.6, lng: -74.2 }, estado: 'ASSIGNED', version: 4 }),
      ),
    );

    const unit = units()[0];
    expect(unit?.ubicacion).toEqual({ lat: 4.7, lng: -74.05 });
    expect(unit?.estado).toBe('AVAILABLE');
    expect(unit?.version).toBe(5);
  });

  it('applies a newer frame and keeps its version', () => {
    const port = new FakeRealtimePort();
    renderHook(() => useFleetSync(port));

    act(() => port.emit(DESTINATIONS.flota, positionFrame({ version: 5 })));
    act(() =>
      port.emit(
        DESTINATIONS.flota,
        positionFrame({ ubicacion: { lat: 4.71, lng: -74.04 }, version: 6 }),
      ),
    );

    expect(units()[0]?.ubicacion).toEqual({ lat: 4.71, lng: -74.04 });
    expect(units()[0]?.version).toBe(6);
  });

  it('applies a frame with the SAME version (state and position of one write share it)', () => {
    const port = new FakeRealtimePort();
    renderHook(() => useFleetSync(port));

    act(() => port.emit(DESTINATIONS.flota, positionFrame({ version: 5 })));
    act(() =>
      port.emit(DESTINATIONS.flota, { ambulanciaId: 'AMB-11', estado: 'EN_MISION', version: 5 }),
    );

    expect(units()[0]?.estado).toBe('ASSIGNED');
  });

  it('discards a stale STATE frame too, so a released unit is not painted busy again', () => {
    const port = new FakeRealtimePort();
    renderHook(() => useFleetSync(port));

    act(() => port.emit(DESTINATIONS.flota, positionFrame({ estado: 'AVAILABLE', version: 8 })));
    act(() =>
      port.emit(DESTINATIONS.flota, { ambulanciaId: 'AMB-11', estado: 'EN_MISION', version: 6 }),
    );

    expect(units()[0]?.estado).toBe('AVAILABLE');
    expect(units()[0]?.version).toBe(8);
  });

  it('applies a frame without version and keeps the version already held', () => {
    const port = new FakeRealtimePort();
    renderHook(() => useFleetSync(port));

    act(() => port.emit(DESTINATIONS.flota, positionFrame({ version: 5 })));
    // The server could not read the row: the state frame travels with version null.
    act(() =>
      port.emit(DESTINATIONS.flota, { ambulanciaId: 'AMB-11', estado: 'EN_MISION', version: null }),
    );

    expect(units()[0]?.estado).toBe('ASSIGNED');
    expect(units()[0]?.version).toBe(5);
  });

  it('carries the version of a unit first seen on a frame', () => {
    useFleetStore.setState({ units: [] });
    const port = new FakeRealtimePort();
    renderHook(() => useFleetSync(port));

    act(() => port.emit(DESTINATIONS.flota, positionFrame({ ambulanceId: 'AMB-99', version: 3 })));
    act(() =>
      port.emit(
        DESTINATIONS.flota,
        positionFrame({ ambulanceId: 'AMB-99', ubicacion: { lat: 1, lng: 1 }, version: 2 }),
      ),
    );

    expect(units()[0]?.ubicacion).toEqual({ lat: 4.7, lng: -74.05 });
  });
});

describe('useFleetSync: signal loss (EP-04.F1.US1, D4)', () => {
  beforeEach(() => useFleetStore.setState({ units: [NEW_UNIT] }));
  afterEach(cleanup);

  it('marks the unit without signal and keeps it at its last known position', () => {
    const port = new FakeRealtimePort();
    renderHook(() => useFleetSync(port));

    act(() => port.emit(DESTINATIONS.flota, positionFrame({ version: 5 })));
    // The signal-loss notice: same shape, last known position, no heading, and
    // the source may be null.
    act(() =>
      port.emit(
        DESTINATIONS.flota,
        positionFrame({ sinSenal: true, heading: null, source: null, version: 6 }),
      ),
    );

    const unit = units()[0];
    expect(units()).toHaveLength(1);
    expect(unit?.sinSenal).toBe(true);
    expect(unit?.ubicacion).toEqual({ lat: 4.7, lng: -74.05 });
    expect(unit?.ultimaPosicionEn).toBe('2026-10-06T15:00:05Z');
    // Signal is data, not a state: the unit keeps the one it had.
    expect(unit?.estado).toBe('AVAILABLE');
  });

  it('clears the mark when the unit reports again', () => {
    const port = new FakeRealtimePort();
    renderHook(() => useFleetSync(port));

    act(() => port.emit(DESTINATIONS.flota, positionFrame({ sinSenal: true, version: 6 })));
    act(() =>
      port.emit(
        DESTINATIONS.flota,
        positionFrame({
          ubicacion: { lat: 4.72, lng: -74.03 },
          sinSenal: false,
          source: 'device',
          ultimaPosicionEn: '2026-10-06T15:01:00Z',
          version: 7,
        }),
      ),
    );

    const unit = units()[0];
    expect(unit?.sinSenal).toBe(false);
    expect(unit?.ubicacion).toEqual({ lat: 4.72, lng: -74.03 });
    expect(unit?.ultimaPosicionEn).toBe('2026-10-06T15:01:00Z');
  });

  it('does not bring "sin señal" back when the notice arrives after the newer report', () => {
    const port = new FakeRealtimePort();
    renderHook(() => useFleetSync(port));

    // Commit order: mark (6), then report (7). Channel order: inverted.
    act(() => port.emit(DESTINATIONS.flota, positionFrame({ sinSenal: false, version: 7 })));
    act(() => port.emit(DESTINATIONS.flota, positionFrame({ sinSenal: true, version: 6 })));

    expect(units()[0]?.sinSenal).toBe(false);
  });

  it('a state frame says nothing about the signal: the mark is kept', () => {
    const port = new FakeRealtimePort();
    renderHook(() => useFleetSync(port));

    act(() => port.emit(DESTINATIONS.flota, positionFrame({ sinSenal: true, version: 6 })));
    act(() =>
      port.emit(DESTINATIONS.flota, { ambulanciaId: 'AMB-11', estado: 'EN_MISION', version: 7 }),
    );

    expect(units()[0]?.sinSenal).toBe(true);
    expect(units()[0]?.estado).toBe('ASSIGNED');
  });
});

describe('useFleetSync: reconnection (EP-04.F1.US1, D7)', () => {
  beforeEach(() => useFleetStore.setState({ units: [NEW_UNIT] }));
  afterEach(cleanup);

  it('P12: keeps the newer local unit when the snapshot read on reconnect is older', () => {
    const port = new FakeRealtimePort();
    renderHook(() => useFleetSync(port));
    act(() => port.emit(DESTINATIONS.flota, positionFrame({ version: 5 })));

    // The channel drops and comes back; the page reads the fleet again.
    act(() => port.setState('STALE'));
    act(() => port.setState('CONNECTED'));
    // A frame lands while that REST read is still on its way...
    act(() =>
      port.emit(
        DESTINATIONS.flota,
        positionFrame({ ubicacion: { lat: 4.8, lng: -74.0 }, version: 9 }),
      ),
    );
    // ...and then the (older) snapshot arrives.
    act(() =>
      useFleetStore
        .getState()
        .hydrate([
          { ...NEW_UNIT, placa: 'ABC101', ubicacion: { lat: 4.75, lng: -74.02 }, version: 8 },
        ]),
    );

    const unit = units()[0];
    expect(unit?.ubicacion).toEqual({ lat: 4.8, lng: -74.0 });
    expect(unit?.version).toBe(9);
    expect(unit?.placa).toBe('ABC101');
  });

  it('takes the snapshot read on reconnect when nothing newer arrived meanwhile', () => {
    const port = new FakeRealtimePort();
    renderHook(() => useFleetSync(port));
    act(() => port.emit(DESTINATIONS.flota, positionFrame({ version: 5 })));

    act(() => port.setState('STALE'));
    act(() => port.setState('CONNECTED'));
    act(() =>
      useFleetStore
        .getState()
        .hydrate([
          { ...NEW_UNIT, ubicacion: { lat: 4.75, lng: -74.02 }, sinSenal: true, version: 8 },
        ]),
    );

    expect(units()[0]?.ubicacion).toEqual({ lat: 4.75, lng: -74.02 });
    expect(units()[0]?.sinSenal).toBe(true);
  });

  it('accepts lower versions after a drop (the backend restarted from zero)', () => {
    const port = new FakeRealtimePort();
    renderHook(() => useFleetSync(port));
    act(() => port.emit(DESTINATIONS.flota, positionFrame({ version: 900 })));

    act(() => port.setState('STALE'));
    act(() => port.setState('CONNECTED'));
    act(() =>
      port.emit(
        DESTINATIONS.flota,
        positionFrame({ ubicacion: { lat: 4.8, lng: -74.0 }, version: 1 }),
      ),
    );

    expect(units()[0]?.ubicacion).toEqual({ lat: 4.8, lng: -74.0 });
    expect(units()[0]?.version).toBe(1);
  });

  it('forgets the versions a previous subscription left in the store', () => {
    // Another screen left the unit at a high version and nobody listened since.
    useFleetStore.setState({ units: [{ ...NEW_UNIT, version: 900 }] });
    const port = new FakeRealtimePort();
    renderHook(() => useFleetSync(port));

    act(() =>
      port.emit(
        DESTINATIONS.flota,
        positionFrame({ ubicacion: { lat: 4.8, lng: -74.0 }, version: 1 }),
      ),
    );

    expect(units()[0]?.ubicacion).toEqual({ lat: 4.8, lng: -74.0 });
  });
});
