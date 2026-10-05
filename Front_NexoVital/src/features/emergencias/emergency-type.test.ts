import { describe, expect, it } from 'vitest';
import { EMERGENCY_TYPE_LABELS, EMERGENCY_TYPE_OPTIONS, emergencyTitle } from './emergency-type';

describe('emergency type catalog', () => {
  it('labels every option and keeps "Otro" last', () => {
    expect(EMERGENCY_TYPE_OPTIONS.map((type) => EMERGENCY_TYPE_LABELS[type])).toEqual([
      'Inundación',
      'Incendio',
      'Derrumbe',
      'Sismo',
      'Accidente',
      'Otro',
    ]);
  });
});

describe('emergencyTitle', () => {
  it('joins the type label and the comment', () => {
    expect(emergencyTitle({ tipo: 'FLOOD', descripcion: ' Calle anegada ' })).toBe(
      'Inundación · Calle anegada',
    );
  });

  it('falls back to whichever part exists', () => {
    expect(emergencyTitle({ tipo: 'FIRE' })).toBe('Incendio');
    expect(emergencyTitle({ descripcion: 'Humo en bodega' })).toBe('Humo en bodega');
    expect(emergencyTitle({})).toBe('');
  });
});
