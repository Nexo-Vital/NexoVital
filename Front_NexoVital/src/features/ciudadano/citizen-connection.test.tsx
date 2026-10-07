import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ambulanceIcon } from '@/features/mapa/markers';
import type { Ambulancia } from '@/types/domain';
import { CitizenMapLegend } from './CitizenMapLegend';
import { availableUnits, CITIZEN_REQUEST_REASONS, countAvailableUnits } from './citizen-request';
import {
  type CitizenCenterCounts,
  citizenUnitBucket,
  countCentersByLevel,
  countUnitsByStatus,
  nearbyAmbulances,
  unitCanReceiveRequest,
  unitIsConnected,
} from './citizen-view';

/**
 * EP-04.F2.US1: a request only reaches units that are available, connected and
 * have signal. The citizen's screen mirrors that rule to count who could come,
 * and shows a unit with a disconnected driver as out of service.
 */

const HERE = { lat: 4.745, lng: -74.095 };

function unit(id: string, overrides: Partial<Ambulancia> = {}): Ambulancia {
  return {
    id,
    placa: id,
    estado: 'AVAILABLE',
    ubicacion: { lat: 4.75, lng: -74.09 },
    zona: 'Suba',
    driverName: '',
    ...overrides,
  };
}

const NO_CENTERS: CitizenCenterCounts = countCentersByLevel([]);

function legendCount(label: string): string {
  const legend = screen.getByRole('complementary', { name: 'Leyenda del mapa' });
  const row = within(legend).getByText(label).closest('li');
  return row?.querySelector('b')?.textContent ?? '';
}

function badgeOf(markup: string): string {
  const start = markup.indexOf('<span class="nv-marker__badge">');
  return markup.slice(start, markup.indexOf('</span>', start));
}

function unitHtml(value: Ambulancia): string {
  return String(ambulanceIcon(value, false).options.html);
}

afterEach(cleanup);

describe('unitIsConnected', () => {
  it('is false only for an explicit `conectada: false`', () => {
    expect(unitIsConnected(unit('A', { conectada: false }))).toBe(false);
    expect(unitIsConnected(unit('A', { conectada: true }))).toBe(true);
    // Fixtures and a backend that predates the field carry nothing: connected.
    expect(unitIsConnected(unit('A'))).toBe(true);
  });
});

describe('unitCanReceiveRequest: the rule of the server', () => {
  it('needs the unit available, connected and with signal', () => {
    expect(unitCanReceiveRequest(unit('A', { conectada: true, sinSenal: false }))).toBe(true);
    expect(unitCanReceiveRequest(unit('A'))).toBe(true);
  });

  it('is false for every situation the server excludes', () => {
    expect(unitCanReceiveRequest(unit('A', { estado: 'ASSIGNED' }))).toBe(false);
    expect(unitCanReceiveRequest(unit('A', { estado: 'EN_ROUTE' }))).toBe(false);
    expect(unitCanReceiveRequest(unit('A', { estado: 'MAINTENANCE' }))).toBe(false);
    expect(unitCanReceiveRequest(unit('A', { conectada: false }))).toBe(false);
    expect(unitCanReceiveRequest(unit('A', { sinSenal: true }))).toBe(false);
  });
});

describe('who a citizen request would reach', () => {
  const fleet = [
    unit('LIBRE-1'),
    unit('LIBRE-2', { conectada: true }),
    unit('OCUPADA', { estado: 'ASSIGNED' }),
    unit('DESCONECTADA', { conectada: false }),
    unit('SIN-SENAL', { sinSenal: true }),
    unit('MANTENIMIENTO', { estado: 'MAINTENANCE' }),
  ];

  it('counts only the units the server would notify', () => {
    expect(countAvailableUnits(fleet)).toBe(2);
    expect(availableUnits(fleet).map((item) => item.id)).toEqual(['LIBRE-1', 'LIBRE-2']);
  });

  it('counts none when every available unit is disconnected or without signal', () => {
    expect(
      countAvailableUnits([
        unit('A', { conectada: false }),
        unit('B', { sinSenal: true }),
        unit('C', { estado: 'ASSIGNED' }),
      ]),
    ).toBe(0);
  });

  it('says why the request cannot be sent', () => {
    expect(CITIZEN_REQUEST_REASONS.noUnits).toBe(
      'No hay ambulancias conectadas y disponibles en este momento.',
    );
  });
});

describe('citizenUnitBucket', () => {
  it('takes a unit with a disconnected driver out of service whatever its state', () => {
    expect(citizenUnitBucket(unit('A', { conectada: false }))).toBe('maintenance');
    expect(citizenUnitBucket(unit('A', { conectada: false, estado: 'MAINTENANCE' }))).toBe(
      'maintenance',
    );
  });

  it('keeps the state bucket for a connected unit', () => {
    expect(citizenUnitBucket(unit('A'))).toBe('free');
    expect(citizenUnitBucket(unit('A', { estado: 'ASSIGNED' }))).toBe('busy');
    expect(citizenUnitBucket(unit('A', { estado: 'MAINTENANCE' }))).toBe('maintenance');
  });

  it('countUnitsByStatus counts by that bucket', () => {
    expect(
      countUnitsByStatus([
        unit('A'),
        unit('B', { conectada: false }),
        unit('C', { estado: 'ASSIGNED' }),
        unit('D', { estado: 'MAINTENANCE' }),
      ]),
    ).toEqual({ free: 1, busy: 1, maintenance: 2 });
  });
});

describe('nearbyAmbulances: connection', () => {
  it('says "Fuera de servicio" instead of an arrival time for a disconnected unit', () => {
    const [row] = nearbyAmbulances([unit('ABC101', { conectada: false })], HERE);

    expect(row?.status).toBe('maintenance');
    expect(row?.detail).toBe('Fuera de servicio');
    expect(row?.detail).not.toContain('min');
  });
});

describe('CitizenMapLegend: connection', () => {
  it('counts a disconnected unit as "Fuera de servicio", not as "Disponible"', () => {
    render(
      <CitizenMapLegend
        counts={NO_CENTERS}
        units={[
          unit('A'),
          unit('B', { conectada: false }),
          unit('C', { estado: 'ASSIGNED' }),
          unit('D', { estado: 'MAINTENANCE' }),
          unit('E', { sinSenal: true }),
        ]}
      />,
    );

    expect(legendCount('Disponible')).toBe('1');
    expect(legendCount('Ocupada')).toBe('1');
    expect(legendCount('Fuera de servicio')).toBe('2');
    expect(legendCount('Sin señal')).toBe('1');
  });

  it('the four rows add up to the fleet', () => {
    const fleet = [
      unit('A'),
      unit('B', { conectada: false }),
      unit('C', { conectada: false, sinSenal: true }),
      unit('D', { estado: 'EN_ROUTE' }),
    ];
    render(<CitizenMapLegend counts={NO_CENTERS} units={fleet} />);

    const total = ['Disponible', 'Ocupada', 'Fuera de servicio', 'Sin señal']
      .map((label) => Number(legendCount(label)))
      .reduce((sum, value) => sum + value, 0);
    expect(total).toBe(fleet.length);
    // Without signal wins: the pin is gray whatever else is true of the unit.
    expect(legendCount('Sin señal')).toBe('1');
    expect(legendCount('Fuera de servicio')).toBe('1');
  });
});

describe('ambulanceIcon: connection', () => {
  it('draws a disconnected unit as out of service, never as available', () => {
    const markup = unitHtml(unit('A', { conectada: false }));

    expect(markup).toContain('nv-marker--maintenance');
    expect(markup).not.toContain('nv-marker--available');
    // Colour AND icon: the badge is neither the check nor the clock.
    expect(badgeOf(markup)).not.toBe(badgeOf(unitHtml(unit('A'))));
    expect(badgeOf(markup)).not.toBe(badgeOf(unitHtml(unit('A', { estado: 'ASSIGNED' }))));
  });

  it('draws it exactly like a unit in maintenance', () => {
    expect(badgeOf(unitHtml(unit('A', { conectada: false })))).toBe(
      badgeOf(unitHtml(unit('A', { estado: 'MAINTENANCE' }))),
    );
  });

  it('keeps the plate on the label', () => {
    expect(unitHtml(unit('ABC101', { conectada: false }))).toContain('ABC101');
  });

  it('a connected unit keeps its own pin', () => {
    expect(unitHtml(unit('A', { conectada: true }))).toContain('nv-marker--available');
  });

  it('without signal still wins over out of service', () => {
    const markup = unitHtml(unit('A', { conectada: false, sinSenal: true }));

    expect(markup).toContain('nv-marker--nosignal');
    expect(badgeOf(markup)).toBe(badgeOf(unitHtml(unit('A', { sinSenal: true }))));
  });
});
