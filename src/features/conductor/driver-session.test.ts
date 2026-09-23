import { describe, expect, it } from 'vitest';
import { DEMO_ACCOUNTS } from '@/mocks/demo-users';
import { MOCK_AMBULANCIAS } from '@/mocks/fixtures';
import { FALLBACK_DRIVER_AMBULANCE_ID, resolveDriverAmbulanceId } from './driver-session';

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
