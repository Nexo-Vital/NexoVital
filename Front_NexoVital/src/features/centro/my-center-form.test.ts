import { describe, expect, it } from 'vitest';
import {
  buildCenterInput,
  buildInsumoInput,
  type CenterFormValues,
  clampWithdrawal,
  emptyInsumoRow,
  hasErrors,
  type InsumoRow,
  MAX_INSUMOS_INICIALES,
  onlyDigits,
  validateCenterForm,
  validateInsumoRow,
} from './my-center-form';

function row(nombre: string, disponible: string, requerido: string): InsumoRow {
  return { ...emptyInsumoRow(), nombre, disponible, requerido };
}

const SUBA = { lat: 4.75, lng: -74.06 };

function values(overrides: Partial<CenterFormValues> = {}): CenterFormValues {
  return {
    nombre: 'Centro Rincón',
    ubicacion: SUBA,
    insumos: [row('Agua potable', '20', '60')],
    ...overrides,
  };
}

describe('emptyInsumoRow', () => {
  it('gives every row its own key', () => {
    expect(emptyInsumoRow().key).not.toBe(emptyInsumoRow().key);
  });
});

describe('onlyDigits', () => {
  it('drops signs, decimals and letters', () => {
    expect(onlyDigits('-12.5a')).toBe('125');
    expect(onlyDigits('')).toBe('');
  });
});

describe('validateInsumoRow', () => {
  it('accepts a named supply with a stock and a maximum', () => {
    expect(validateInsumoRow(row('Agua', '0', '1'))).toEqual({});
  });

  it('accepts a stock above the maximum: the center is simply complete', () => {
    expect(validateInsumoRow(row('Agua', '80', '60'))).toEqual({});
  });

  it('requires the name, the stock and a maximum of at least one', () => {
    const errors = validateInsumoRow(row('  ', '', '0'));

    expect(errors.nombre).toBe('Escribe el nombre del insumo.');
    expect(errors.disponible).toBe('Escribe cuántas unidades tienes hoy (0 o más).');
    expect(errors.requerido).toBe('Escribe el máximo que necesita el centro (1 o más).');
  });

  it('rejects a name the center already has, ignoring case and spaces', () => {
    expect(validateInsumoRow(row(' AGUA ', '1', '5'), ['agua']).nombre).toBe(
      'Ese insumo ya está en la lista.',
    );
  });

  it('rejects amounts that are not whole numbers', () => {
    expect(validateInsumoRow(row('Agua', '1.5', '5')).disponible).toBeDefined();
    expect(validateInsumoRow(row('Agua', '1', '-5')).requerido).toBeDefined();
  });
});

describe('buildInsumoInput', () => {
  it('trims the name and turns the amounts into numbers', () => {
    expect(buildInsumoInput(row('  Cobijas ', '5', '40'))).toEqual({
      nombre: 'Cobijas',
      disponible: 5,
      requerido: 40,
    });
  });

  it('returns null for an invalid row', () => {
    expect(buildInsumoInput(row('Cobijas', '', '40'))).toBeNull();
  });
});

describe('validateCenterForm', () => {
  it('accepts a named, located center with one valid supply', () => {
    expect(hasErrors(validateCenterForm(values()))).toBe(false);
  });

  it('requires the name, the location and at least one supply', () => {
    const errors = validateCenterForm(values({ nombre: ' ', ubicacion: null, insumos: [] }));

    expect(errors.nombre).toBe('Escribe el nombre del centro.');
    expect(errors.ubicacion).toContain('Indica dónde queda el centro');
    expect(errors.insumos).toBe('Agrega al menos un insumo.');
  });

  it('flags the SECOND row when two supplies share a name', () => {
    const first = row('Agua', '1', '5');
    const second = row('agua', '2', '6');

    const errors = validateCenterForm(values({ insumos: [first, second] }));

    expect(errors.filas?.[first.key]).toBeUndefined();
    expect(errors.filas?.[second.key]?.nombre).toBe('Ese insumo ya está en la lista.');
  });

  it('caps the number of supplies a center is created with', () => {
    const insumos = Array.from({ length: MAX_INSUMOS_INICIALES + 1 }, (_, index) =>
      row(`Insumo ${index}`, '1', '5'),
    );

    expect(validateCenterForm(values({ insumos })).insumos).toContain(
      String(MAX_INSUMOS_INICIALES),
    );
  });
});

describe('hasErrors', () => {
  it('ignores keys whose message was cleared', () => {
    expect(hasErrors({ nombre: undefined, filas: {} })).toBe(false);
    expect(hasErrors({ nombre: 'x' })).toBe(true);
    expect(hasErrors({ filas: { a: { nombre: 'x' } } })).toBe(true);
  });
});

describe('buildCenterInput', () => {
  it('builds the request body from a valid form', () => {
    const input = buildCenterInput(
      values({
        nombre: '  Centro Rincón ',
        insumos: [row('Agua potable', '20', '60'), row('Cobijas', '0', '30')],
      }),
    );

    expect(input).toEqual({
      nombre: 'Centro Rincón',
      ubicacion: SUBA,
      items: [
        { nombre: 'Agua potable', disponible: 20, requerido: 60 },
        { nombre: 'Cobijas', disponible: 0, requerido: 30 },
      ],
    });
  });

  it('returns null while the form is invalid', () => {
    expect(buildCenterInput(values({ ubicacion: null }))).toBeNull();
  });
});

describe('clampWithdrawal', () => {
  it('keeps the amount between one and what the center has', () => {
    expect(clampWithdrawal(12, 20)).toBe(12);
    expect(clampWithdrawal(0, 20)).toBe(1);
    expect(clampWithdrawal(99, 20)).toBe(20);
  });

  it('returns zero when there is nothing to withdraw', () => {
    expect(clampWithdrawal(5, 0)).toBe(0);
  });
});
