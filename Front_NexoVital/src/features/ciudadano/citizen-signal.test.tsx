import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Ambulancia } from '@/types/domain';
import { CitizenMapLegend } from './CitizenMapLegend';
import {
  type CitizenCenterCounts,
  countCentersByLevel,
  nearbyAmbulances,
  UNIT_NO_SIGNAL_LABEL,
  unitHasLostSignal,
} from './citizen-view';

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

/** The count written at the end of a legend row. */
function legendCount(label: string): string {
  const legend = screen.getByRole('complementary', { name: 'Leyenda del mapa' });
  const row = within(legend).getByText(label).closest('li');
  return row?.querySelector('b')?.textContent ?? '';
}

describe('unitHasLostSignal', () => {
  it('is true only for an explicit sinSenal', () => {
    expect(unitHasLostSignal(unit('A', { sinSenal: true }))).toBe(true);
    expect(unitHasLostSignal(unit('A', { sinSenal: false }))).toBe(false);
    // Demo fixtures and old frames carry no signal field: they have signal.
    expect(unitHasLostSignal(unit('A'))).toBe(false);
  });
});

describe('nearbyAmbulances: signal (EP-04.F1.US1)', () => {
  it('says "Sin señal" instead of an arrival time for a unit without signal', () => {
    const [row] = nearbyAmbulances([unit('ABC101', { sinSenal: true })], HERE);

    expect(row?.detail).toBe(UNIT_NO_SIGNAL_LABEL);
    expect(row?.detail).not.toContain('min');
  });

  it('keeps the unit in the list and its state untouched', () => {
    const rows = nearbyAmbulances(
      [unit('ABC101', { sinSenal: true, estado: 'ASSIGNED' }), unit('ABC202')],
      HERE,
    );

    expect(rows.map((row) => row.ambulance.id).sort()).toEqual(['ABC101', 'ABC202']);
    expect(rows.find((row) => row.ambulance.id === 'ABC101')?.status).toBe('busy');
  });

  it('still shows distance and ETA for a free unit with signal', () => {
    const [row] = nearbyAmbulances([unit('ABC202', { sinSenal: false })], HERE);

    expect(row?.detail).toMatch(/km · \d+ min$/);
  });
});

describe('CitizenMapLegend: signal (EP-04.F1.US1)', () => {
  afterEach(cleanup);

  it('shows the "Sin señal" row with its count', () => {
    render(
      <CitizenMapLegend
        counts={NO_CENTERS}
        units={[
          unit('ABC101'),
          unit('ABC202', { sinSenal: true }),
          unit('ABC303', { estado: 'ASSIGNED', sinSenal: true }),
          unit('ABC404', { estado: 'ASSIGNED' }),
        ]}
      />,
    );

    expect(legendCount('Sin señal')).toBe('2');
  });

  it('counts a unit without signal in its own row, not as free or busy', () => {
    render(
      <CitizenMapLegend
        counts={NO_CENTERS}
        units={[
          unit('ABC101'),
          unit('ABC202', { sinSenal: true }),
          unit('ABC303', { estado: 'ASSIGNED', sinSenal: true }),
          unit('ABC404', { estado: 'ASSIGNED' }),
        ]}
      />,
    );

    // Each row counts the pins of its colour on the map.
    expect(legendCount('Disponible')).toBe('1');
    expect(legendCount('Ocupada')).toBe('1');
  });

  it('shows the row with 0 when every unit has signal', () => {
    render(<CitizenMapLegend counts={NO_CENTERS} units={[unit('ABC101'), unit('ABC202')]} />);

    expect(legendCount('Sin señal')).toBe('0');
    expect(legendCount('Disponible')).toBe('2');
  });
});
