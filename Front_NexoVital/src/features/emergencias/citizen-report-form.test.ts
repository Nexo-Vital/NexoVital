import { describe, expect, it } from 'vitest';
import {
  buildCitizenReportInput,
  MAX_DESCRIPCION,
  validateCitizenReport,
} from './citizen-report-form';

const VALID = {
  tipo: 'LANDSLIDE' as const,
  nivel: 'HIGH' as const,
  descripcion: 'Derrumbe en Suba',
  lat: '4.73',
  lng: '-74.08',
};

describe('validateCitizenReport', () => {
  it('requires the description and valid coordinates', () => {
    const errors = validateCitizenReport({ ...VALID, descripcion: '  ', lat: 'nope', lng: '' });

    expect(errors).toEqual({
      descripcion: expect.any(String),
      lat: expect.any(String),
      lng: expect.any(String),
    });
  });

  it('requires the emergency type', () => {
    expect(validateCitizenReport({ ...VALID, tipo: '' })).toEqual({
      tipo: expect.any(String),
    });
  });

  it('accepts a complete report', () => {
    expect(validateCitizenReport(VALID)).toEqual({});
  });

  it('rejects a description past the backend column length', () => {
    const errors = validateCitizenReport({
      ...VALID,
      descripcion: 'x'.repeat(MAX_DESCRIPCION + 1),
    });

    expect(errors.descripcion).toEqual(expect.any(String));
    expect(errors.lat).toBeUndefined();
    expect(errors.lng).toBeUndefined();
  });

  it('accepts a description exactly at the backend column length', () => {
    expect(validateCitizenReport({ ...VALID, descripcion: 'x'.repeat(MAX_DESCRIPCION) })).toEqual(
      {},
    );
  });
});

describe('buildCitizenReportInput', () => {
  it('builds the input with parsed coordinates and a trimmed description', () => {
    expect(buildCitizenReportInput({ ...VALID, descripcion: '  Derrumbe  ' })).toEqual({
      ubicacion: { lat: 4.73, lng: -74.08 },
      tipo: 'LANDSLIDE',
      nivel: 'HIGH',
      descripcion: 'Derrumbe',
    });
  });

  it('never includes an id, estado or zonaId', () => {
    const input = buildCitizenReportInput(VALID);

    expect(input).not.toBeNull();
    expect(input).not.toHaveProperty('id');
    expect(input).not.toHaveProperty('estado');
    expect(input).not.toHaveProperty('zonaId');
  });

  it('returns null when no type was picked', () => {
    expect(buildCitizenReportInput({ ...VALID, tipo: '' })).toBeNull();
  });

  it('returns null for invalid coordinates', () => {
    expect(buildCitizenReportInput({ ...VALID, lng: 'x' })).toBeNull();
  });
});
