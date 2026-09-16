import { describe, expect, it } from 'vitest';
import { MOCK_AMBULANCIAS } from '@/mocks/fixtures';
import { buildAmbulance, nextAmbulanceId, validateFleetForm } from './fleet-form';

const VALID = {
  driverName: 'New Driver',
  estado: 'AVAILABLE' as const,
  lat: '4.65',
  lng: '-74.06',
};

describe('nextAmbulanceId', () => {
  it('continues the AMB sequence after the fixtures', () => {
    expect(nextAmbulanceId(MOCK_AMBULANCIAS)).toBe('AMB-11');
  });

  it('starts at AMB-01 for an empty fleet', () => {
    expect(nextAmbulanceId([])).toBe('AMB-01');
  });
});

describe('validateFleetForm', () => {
  it('requires a driver name and in-range coordinates', () => {
    const errors = validateFleetForm({ ...VALID, driverName: '  ', lat: '999', lng: 'x' });

    expect(errors.driverName).toBeDefined();
    expect(errors.lat).toBeDefined();
    expect(errors.lng).toBeDefined();
  });

  it('skips position validation when editing', () => {
    const errors = validateFleetForm({ ...VALID, lat: '', lng: '' }, { requirePosition: false });

    expect(errors).toEqual({});
  });
});

describe('buildAmbulance', () => {
  it('builds a unit from valid form values', () => {
    const unit = buildAmbulance(VALID, 'AMB-11');

    expect(unit).toMatchObject({
      id: 'AMB-11',
      estado: 'AVAILABLE',
      driverName: 'New Driver',
      ubicacion: { lat: 4.65, lng: -74.06 },
    });
  });

  it('returns null when the coordinates are invalid', () => {
    expect(buildAmbulance({ ...VALID, lat: 'abc' }, 'AMB-11')).toBeNull();
  });
});
