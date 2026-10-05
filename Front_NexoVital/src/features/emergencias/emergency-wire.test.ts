import { describe, expect, it } from 'vitest';
import {
  EMERGENCY_LEVEL_FROM_WIRE,
  EMERGENCY_LEVEL_TO_WIRE,
  EMERGENCY_STATUS_FROM_WIRE,
  EMERGENCY_TYPE_FROM_WIRE,
  EMERGENCY_TYPE_TO_WIRE,
  fromWireEmergency,
} from './emergency-wire';

/** A live-shaped payload: Spanish enums and the server-resolved zone. */
const WIRE = {
  id: 'b3f1c0de-0000-4000-8000-000000000001',
  ubicacion: { lat: 4.73, lng: -74.08 },
  nivel: 'ALTO',
  estado: 'REGISTRADA',
  descripcion: 'Derrumbe en Suba',
  zonaId: 'Suba',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('fromWireEmergency', () => {
  it('translates the Spanish level and status to the English UI enums', () => {
    expect(fromWireEmergency(WIRE)).toMatchObject({ nivel: 'HIGH', estado: 'REPORTED' });
  });

  it('translates the Spanish emergency type to the English UI enum', () => {
    expect(fromWireEmergency({ ...WIRE, tipo: 'DERRUMBE' })?.tipo).toBe('LANDSLIDE');
    expect(fromWireEmergency({ ...WIRE, tipo: 'OTRO' })?.tipo).toBe('OTHER');
  });

  it('keeps the emergency and omits the type when the wire sends none or an unknown one', () => {
    expect(fromWireEmergency(WIRE)).not.toBeNull();
    expect(fromWireEmergency(WIRE)).not.toHaveProperty('tipo');
    expect(fromWireEmergency({ ...WIRE, tipo: 'TORNADO' })).not.toHaveProperty('tipo');
    expect(fromWireEmergency({ ...WIRE, tipo: 'toString' })).not.toHaveProperty('tipo');
  });

  it('passes an already-English type through', () => {
    expect(fromWireEmergency({ ...WIRE, tipo: 'FIRE' })?.tipo).toBe('FIRE');
  });

  it('maps a null zonaId to the empty-string convention', () => {
    expect(fromWireEmergency({ ...WIRE, zonaId: null })?.zonaId).toBe('');
  });

  it('maps an absent zonaId to the empty-string convention', () => {
    expect(fromWireEmergency({ ...WIRE, zonaId: undefined })?.zonaId).toBe('');
  });

  it('carries the version when the wire sends a finite number', () => {
    expect(fromWireEmergency({ ...WIRE, version: 7 })?.version).toBe(7);
  });

  it('omits the version when the wire does not send one', () => {
    expect(fromWireEmergency(WIRE)).not.toHaveProperty('version');
  });

  it('omits the version when the wire sends a non-number', () => {
    expect(fromWireEmergency({ ...WIRE, version: '7' })).not.toHaveProperty('version');
    expect(fromWireEmergency({ ...WIRE, version: Number.NaN })).not.toHaveProperty('version');
  });

  it('is idempotent: already-English values pass through', () => {
    const normalized = { ...WIRE, nivel: 'HIGH', estado: 'REPORTED' };

    expect(fromWireEmergency(normalized)).toMatchObject({ nivel: 'HIGH', estado: 'REPORTED' });
  });

  it('rejects malformed shapes without throwing', () => {
    expect(fromWireEmergency(null)).toBeNull();
    expect(fromWireEmergency('nope')).toBeNull();
    expect(fromWireEmergency({})).toBeNull();
    expect(fromWireEmergency({ ...WIRE, id: 7 })).toBeNull();
    expect(fromWireEmergency({ ...WIRE, nivel: 'URGENTE' })).toBeNull();
    expect(fromWireEmergency({ ...WIRE, estado: 'PENDIENTE' })).toBeNull();
    expect(fromWireEmergency({ ...WIRE, createdAt: undefined })).toBeNull();
    expect(fromWireEmergency({ ...WIRE, ubicacion: { lat: '4.7', lng: -74 } })).toBeNull();
    expect(fromWireEmergency({ ...WIRE, ubicacion: null })).toBeNull();
  });

  it('does not read a prototype key as a wire literal', () => {
    expect(fromWireEmergency({ ...WIRE, nivel: 'toString' })).toBeNull();
  });

  it('declares every contract literal', () => {
    expect(EMERGENCY_LEVEL_FROM_WIRE).toEqual({
      BAJO: 'LOW',
      MEDIO: 'MEDIUM',
      ALTO: 'HIGH',
      CRITICO: 'CRITICAL',
    });
    expect(EMERGENCY_STATUS_FROM_WIRE).toEqual({
      REGISTRADA: 'REPORTED',
      EN_ATENCION: 'IN_PROGRESS',
      EN_ESPERA: 'ON_HOLD',
      RESUELTA: 'RESOLVED',
      CERRADA: 'CLOSED',
    });
    expect(EMERGENCY_LEVEL_TO_WIRE).toEqual({
      LOW: 'BAJO',
      MEDIUM: 'MEDIO',
      HIGH: 'ALTO',
      CRITICAL: 'CRITICO',
    });
  });

  it('declares every emergency type in both directions', () => {
    expect(EMERGENCY_TYPE_FROM_WIRE).toEqual({
      INUNDACION: 'FLOOD',
      INCENDIO: 'FIRE',
      DERRUMBE: 'LANDSLIDE',
      SISMO: 'EARTHQUAKE',
      ACCIDENTE: 'ACCIDENT',
      OTRO: 'OTHER',
    });
    for (const [wire, ui] of Object.entries(EMERGENCY_TYPE_FROM_WIRE)) {
      expect(EMERGENCY_TYPE_TO_WIRE[ui]).toBe(wire);
    }
  });
});
