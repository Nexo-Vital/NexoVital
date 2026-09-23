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
  it('continues the A sequence after the fixtures', () => {
    expect(nextAmbulanceId(MOCK_AMBULANCIAS)).toBe('A-16');
  });

  it('starts at A-01 for an empty fleet', () => {
    expect(nextAmbulanceId([])).toBe('A-01');
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
    const unit = buildAmbulance(VALID, 'A-16');

    expect(unit).toMatchObject({
      id: 'A-16',
      estado: 'AVAILABLE',
      driverName: 'New Driver',
      ubicacion: { lat: 4.65, lng: -74.06 },
    });
  });

  it('returns null when the coordinates are invalid', () => {
    expect(buildAmbulance({ ...VALID, lat: 'abc' }, 'A-16')).toBeNull();
  });
});
