import { describe, expect, it } from 'vitest';
import type { Emergencia } from '@/types/domain';
import { emergencyIcon } from './markers';

function emergency(overrides: Partial<Emergencia> = {}): Emergencia {
  return {
    id: 'e8ce2d82-6881-45b1-92a4-e7fc232ec740',
    ubicacion: { lat: 4.65, lng: -74.06 },
    nivel: 'HIGH',
    estado: 'REPORTED',
    descripcion: 'Árbol caído',
    zonaId: '',
    createdAt: '2026-10-04T00:00:00Z',
    ...overrides,
  } as Emergencia;
}

function html(value: Emergencia): string {
  return String(emergencyIcon(value).options.html);
}

describe('emergencyIcon', () => {
  it('labels the marker with the emergency type, never with its id', () => {
    const markup = html(emergency({ tipo: 'FLOOD' }));

    expect(markup).toContain('<span class="nv-marker__label">Inundación</span>');
    expect(markup).not.toContain('>e8ce2d82-6881-45b1-92a4-e7fc232ec740<');
    // The id is still reachable for tests and debugging.
    expect(markup).toContain('data-nv-emergency="e8ce2d82-6881-45b1-92a4-e7fc232ec740"');
  });

  it.each([
    ['LOW', 'nv-marker--low'],
    ['MEDIUM', 'nv-marker--medium'],
    ['HIGH', 'nv-marker--high'],
    ['CRITICAL', 'nv-marker--critical'],
  ] as const)('colours the %s level through its CSS modifier', (nivel, modifier) => {
    expect(html(emergency({ tipo: 'FIRE', nivel }))).toContain(`nv-marker--event ${modifier}`);
  });

  it('draws a different glyph for every type', () => {
    const types = ['FLOOD', 'FIRE', 'LANDSLIDE', 'EARTHQUAKE', 'ACCIDENT', 'OTHER'] as const;
    const glyphs = types.map((tipo) => {
      const markup = html(emergency({ tipo }));
      return markup.slice(markup.indexOf('<svg'), markup.indexOf('</svg>'));
    });
    expect(new Set(glyphs).size).toBe(types.length);
  });

  it('falls back to a generic label when the emergency has no type', () => {
    expect(html(emergency())).toContain('<span class="nv-marker__label">Emergencia</span>');
  });
});
