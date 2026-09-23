import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MOCK_AMBULANCIAS } from '@/mocks/fixtures';
import {
  CITIZEN_ARRIVED_STEP,
  CITIZEN_EN_ROUTE_STEP,
  CITIZEN_TRACKING_STEPS,
  DRIVER_ARRIVED_STEP,
  DRIVER_EN_ROUTE_STEP,
  DRIVER_TRACKING_STEPS,
  driverInitials,
  formatArrivalClock,
  formatClockTime,
  formatElapsedSince,
  type TimelineEntry,
  TrackingSteps,
  TrackingTimeline,
  unitDetailRows,
} from './tracking';

describe('tracking steps', () => {
  afterEach(cleanup);

  it('declares the citizen and driver step lists of the mockup', () => {
    expect(CITIZEN_TRACKING_STEPS).toEqual(['Solicitada', 'Aceptada', 'En camino', 'Llegó']);
    expect(DRIVER_TRACKING_STEPS).toEqual(['Aceptada', 'En camino', 'Llegada', 'Finalizada']);
    // "En camino" is the active step on both rails right after an accept.
    expect(CITIZEN_TRACKING_STEPS[CITIZEN_EN_ROUTE_STEP]).toBe('En camino');
    expect(DRIVER_TRACKING_STEPS[DRIVER_EN_ROUTE_STEP]).toBe('En camino');
    // The citizen arrival step is the mockup's step 4 ("Llegó", index 3), since
    // its list starts at "Solicitada".
    expect(CITIZEN_TRACKING_STEPS[CITIZEN_ARRIVED_STEP]).toBe('Llegó');
    // The driver arrival step is "Llegada" (index 2), NOT the mockup's literal
    // index 3: the driver's list starts at "Aceptada", so index 3 is
    // "Finalizada", a step the driver has not reached on arrival (mockup defect).
    expect(DRIVER_TRACKING_STEPS[DRIVER_ARRIVED_STEP]).toBe('Llegada');
    expect(DRIVER_TRACKING_STEPS[DRIVER_ARRIVED_STEP]).not.toBe('Finalizada');
  });

  it('marks only the active step with aria-current', () => {
    render(
      <TrackingSteps
        steps={DRIVER_TRACKING_STEPS}
        activeIndex={DRIVER_EN_ROUTE_STEP}
        label="Progreso de la misión"
      />,
    );

    const items = within(screen.getByRole('list', { name: 'Progreso de la misión' })).getAllByRole(
      'listitem',
    );
    expect(items.map((item) => item.textContent)).toEqual([
      'Aceptada',
      'En camino',
      'Llegada',
      'Finalizada',
    ]);
    expect(items[1]).toHaveAttribute('aria-current', 'step');
    expect(items[0]).not.toHaveAttribute('aria-current');
    expect(items[2]).not.toHaveAttribute('aria-current');
    expect(items[3]).not.toHaveAttribute('aria-current');
  });

  it('makes "Llegada" the active step on arrival and leaves "Finalizada" pending', () => {
    render(
      <TrackingSteps
        steps={DRIVER_TRACKING_STEPS}
        activeIndex={DRIVER_ARRIVED_STEP}
        label="Progreso de la misión"
      />,
    );

    const items = within(screen.getByRole('list', { name: 'Progreso de la misión' })).getAllByRole(
      'listitem',
    );
    expect(items[2]).toHaveTextContent('Llegada');
    expect(items[2]).toHaveAttribute('aria-current', 'step');
    // "En camino" is behind the driver, so it carries the completion tick.
    expect(items[1].querySelector('svg')).not.toBeNull();
    // "Finalizada" has not happened: it is neither current nor ticked.
    expect(items[3]).toHaveTextContent('Finalizada');
    expect(items[3]).not.toHaveAttribute('aria-current');
    expect(items[3].querySelector('svg')).toBeNull();
  });
});

describe('formatArrivalClock', () => {
  it('lands the ETA on a real wall clock', () => {
    const now = new Date('2026-01-01T09:40:00');

    expect(formatArrivalClock(7, now)).toBe('9:47');
    expect(formatArrivalClock(25, now)).toBe('10:05');
  });
});

describe('formatClockTime', () => {
  it('formats a real instant as H:MM', () => {
    expect(formatClockTime(new Date('2026-01-01T09:47:00').getTime())).toBe('9:47');
    expect(formatClockTime(new Date('2026-01-01T10:05:00').getTime())).toBe('10:05');
  });
});

describe('TrackingTimeline', () => {
  it('renders each entry with its real instant and omits a missing one', () => {
    const entries: TimelineEntry[] = [
      { text: 'Aceptaste la solicitud', at: new Date('2026-01-01T09:42:00').getTime() },
      { text: 'Declaraste la llegada', at: null },
    ];

    render(<TrackingTimeline entries={entries} label="Línea de tiempo de la misión" />);

    const items = within(
      screen.getByRole('list', { name: 'Línea de tiempo de la misión' }),
    ).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Aceptaste la solicitud9:42',
      'Declaraste la llegada',
    ]);
  });
});

describe('formatElapsedSince', () => {
  it('reads seconds, then minutes, and never goes negative', () => {
    const now = new Date('2026-01-01T09:40:20');

    expect(formatElapsedSince(now.getTime() - 20_000, now)).toBe('hace 20 s');
    expect(formatElapsedSince(now.getTime() - 75_000, now)).toBe('hace 1 min');
    expect(formatElapsedSince(now.getTime() + 5_000, now)).toBe('hace 0 s');
  });
});

describe('driverInitials', () => {
  it('takes the first letter of the first two name words', () => {
    expect(driverInitials('Carlos Pérez Gómez')).toBe('CP');
    expect(driverInitials('Laura Restrepo Díaz')).toBe('LR');
    expect(driverInitials('Madonna')).toBe('M');
    expect(driverInitials('   ')).toBe('');
  });
});

describe('unitDetailRows', () => {
  it('lists the real unit data from the fleet fixture', () => {
    const unit = MOCK_AMBULANCIAS.find((candidate) => candidate.id === 'A-07');
    if (!unit) {
      throw new Error('A-07 missing from fixtures');
    }

    expect(unitDetailRows(unit)).toEqual([
      { label: 'Unidad', value: 'A-07' },
      { label: 'Placa', value: 'WNR-418' },
      { label: 'Modelo', value: 'Renault Master 2023' },
      { label: 'Tipo', value: 'Básica (TAB)' },
    ]);
  });

  it('omits model and type a unit does not know yet instead of inventing them', () => {
    expect(
      unitDetailRows({
        id: 'A-99',
        placa: 'XXX-000',
        estado: 'AVAILABLE',
        ubicacion: { lat: 4.7, lng: -74.1 },
        zona: 'Suba',
        driverName: 'Nadie',
      }),
    ).toEqual([
      { label: 'Unidad', value: 'A-99' },
      { label: 'Placa', value: 'XXX-000' },
    ]);
  });
});
