import { describe, expect, it } from 'vitest';
import type { Ambulancia, Emergencia } from '@/types/domain';
import { ambulanceIcon, emergencyIcon } from './markers';

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

function ambulance(overrides: Partial<Ambulancia> = {}): Ambulancia {
  return {
    id: '8b6f2f0e-0000-4000-8000-0000000000a1',
    placa: 'ABC101',
    estado: 'AVAILABLE',
    ubicacion: { lat: 4.745, lng: -74.095 },
    zona: 'Suba',
    driverName: '',
    ...overrides,
  };
}

function unitHtml(value: Ambulancia): string {
  return String(ambulanceIcon(value, false).options.html);
}

/** The badge markup: the second, always-on channel of the pin. */
function badgeOf(markup: string): string {
  const start = markup.indexOf('<span class="nv-marker__badge">');
  return markup.slice(start, markup.indexOf('</span>', start));
}

describe('ambulanceIcon: signal (EP-04.F1.US1)', () => {
  it('P13: draws a unit without signal gray, with its own badge icon', () => {
    const markup = unitHtml(ambulance({ sinSenal: true }));

    // Colour: the CSS modifier that turns the circle gray.
    expect(markup).toContain('nv-marker--nosignal');
    // Icon: the badge is neither the free check nor the busy clock.
    expect(badgeOf(markup)).not.toBe(badgeOf(unitHtml(ambulance({ estado: 'AVAILABLE' }))));
    expect(badgeOf(markup)).not.toBe(badgeOf(unitHtml(ambulance({ estado: 'ASSIGNED' }))));
  });

  it('P13: keeps the unit on the map, named by its plate and with its state', () => {
    const markup = unitHtml(ambulance({ sinSenal: true, estado: 'ASSIGNED' }));

    expect(markup).toContain('<span class="nv-marker__label">ABC101</span>');
    // Signal is data, not a state: the state class is still there.
    expect(markup).toContain('nv-marker--assigned');
  });

  it('uses the same badge for every unit without signal, whatever its state', () => {
    expect(badgeOf(unitHtml(ambulance({ sinSenal: true, estado: 'AVAILABLE' })))).toBe(
      badgeOf(unitHtml(ambulance({ sinSenal: true, estado: 'ASSIGNED' }))),
    );
  });

  it.each([
    ['explicitly false', { sinSenal: false }],
    ['absent (demo fixtures, old frames)', {}],
  ] as const)('draws a unit with signal as before when sinSenal is %s', (_case, overrides) => {
    const markup = unitHtml(ambulance(overrides));

    expect(markup).not.toContain('nv-marker--nosignal');
    expect(markup).toContain('nv-marker--available');
  });
});
