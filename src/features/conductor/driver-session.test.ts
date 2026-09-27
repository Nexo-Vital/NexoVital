import { describe, expect, it } from 'vitest';
import { DEMO_ACCOUNTS } from '@/mocks/demo-users';
import { MOCK_AMBULANCIAS } from '@/mocks/fixtures';
import {
  FALLBACK_DRIVER_AMBULANCE_ID,
  resolveDriverAmbulanceId,
  resolveDriverAmbulanceIdFromFleet,
} from './driver-session';

describe('resolveDriverAmbulanceId', () => {
  it('gives each seeded demo conductor a distinct unit', () => {
    const conductorIds = DEMO_ACCOUNTS.filter((account) => account.rol === 'CONDUCTOR').map(
      (account) => account.id,
    );

    expect(conductorIds).toHaveLength(5);
    const units = conductorIds.map((id) => resolveDriverAmbulanceId(id));

    expect(units).toEqual(['A-07', 'A-12', 'A-03', 'A-09', 'A-15']);
    // The regression being fixed: five drivers used to collapse onto one unit,
    // so "the first to accept wins" could never involve two real accounts.
    expect(new Set(units).size).toBe(units.length);
  });

  it('resolves every demo conductor to a unit that exists in the fleet', () => {
    const fleetIds = new Set(MOCK_AMBULANCIAS.map((unit) => unit.id));

    for (const account of DEMO_ACCOUNTS.filter((item) => item.rol === 'CONDUCTOR')) {
      expect(fleetIds.has(resolveDriverAmbulanceId(account.id))).toBe(true);
    }
  });

  it('falls back to A-07 for an unknown or missing user', () => {
    expect(resolveDriverAmbulanceId('not-a-driver')).toBe(FALLBACK_DRIVER_AMBULANCE_ID);
    expect(resolveDriverAmbulanceId(null)).toBe(FALLBACK_DRIVER_AMBULANCE_ID);
    expect(resolveDriverAmbulanceId(undefined)).toBe(FALLBACK_DRIVER_AMBULANCE_ID);
  });
});

describe('resolveDriverAmbulanceIdFromFleet', () => {
  const REAL_DRIVER = 'e1b0f0c4-0000-4000-8000-0000000000d1';

  // The real backend serves real ambulance UUIDs, not the demo A-xx labels.
  const realFleet = [
    { id: '8b6f2f0e-0000-4000-8000-0000000000a1', conductorId: 'otro-conductor' },
    { id: '8b6f2f0e-0000-4000-8000-0000000000a2', conductorId: REAL_DRIVER },
  ];

  it('resolves the unit whose conductorId is the session user', () => {
    expect(resolveDriverAmbulanceIdFromFleet(realFleet, REAL_DRIVER)).toBe(
      '8b6f2f0e-0000-4000-8000-0000000000a2',
    );
  });

  it('returns null when no unit belongs to the driver', () => {
    expect(resolveDriverAmbulanceIdFromFleet(realFleet, 'conductor-sin-unidad')).toBeNull();
    expect(resolveDriverAmbulanceIdFromFleet(realFleet, null)).toBeNull();
    expect(resolveDriverAmbulanceIdFromFleet(realFleet, undefined)).toBeNull();
  });

  it('never matches a unit with no driver to a driver', () => {
    // A unit without conductorId (JSON null / absent) must not be claimed.
    const fleet = [{ id: 'unit-sin-conductor' }, { id: 'unit-sin-conductor-2' }];
    expect(resolveDriverAmbulanceIdFromFleet(fleet, REAL_DRIVER)).toBeNull();
  });
});
