import { describe, expect, it } from 'vitest';
import { MOCK_EMERGENCIAS } from '@/mocks/fixtures';
import { buildEmergency, nextEmergencyId, validateEmergencyForm } from './emergency-form';

const VALID = {
  nivel: 'HIGH' as const,
  zonaId: 'Kennedy',
  descripcion: 'Two-vehicle collision',
  lat: '4.628',
  lng: '-74.148',
};

describe('nextEmergencyId', () => {
  it('continues the EMG sequence', () => {
    expect(nextEmergencyId(MOCK_EMERGENCIAS)).toBe('EMG-006');
  });

  it('starts at EMG-001 for an empty list', () => {
    expect(nextEmergencyId([])).toBe('EMG-001');
  });
});

describe('validateEmergencyForm', () => {
  it('requires zone, description and coordinates', () => {
    const errors = validateEmergencyForm({
      ...VALID,
      zonaId: ' ',
      descripcion: '',
      lat: 'nope',
      lng: '',
    });

    expect(errors).toEqual({
      zonaId: expect.any(String),
      descripcion: expect.any(String),
      lat: expect.any(String),
      lng: expect.any(String),
    });
  });

  it('accepts a complete form', () => {
    expect(validateEmergencyForm(VALID)).toEqual({});
  });
});

describe('buildEmergency', () => {
  it('builds a REPORTED emergency with an auto id', () => {
    const emergency = buildEmergency(VALID, 'EMG-006', 1_000);

    expect(emergency).toMatchObject({
      id: 'EMG-006',
      nivel: 'HIGH',
      estado: 'REPORTED',
      zonaId: 'Kennedy',
      descripcion: 'Two-vehicle collision',
      ubicacion: { lat: 4.628, lng: -74.148 },
    });
    expect(emergency?.createdAt).toBe(new Date(1_000).toISOString());
  });

  it('returns null for invalid coordinates', () => {
    expect(buildEmergency({ ...VALID, lng: 'x' }, 'EMG-006')).toBeNull();
  });
});
