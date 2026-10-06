import type { Ubicacion } from '@/types/domain';
import type { CrearMiCentroInput, NuevoInsumoInput } from './my-center-api';

/**
 * Reglas del formulario "Crear centro" y del alta de un insumo. Son las mismas
 * que aplica el backend (`NuevoItemInventario.validar`,
 * `CentroDeAdministradorUseCaseImpl`), repetidas aquí para que el error salga
 * junto al campo y no como un 400 genérico. El servidor sigue siendo quien
 * decide.
 */
export const MAX_NOMBRE_CENTRO = 120;
export const MAX_NOMBRE_INSUMO = 120;
export const MAX_CANTIDAD = 1_000_000;
export const MAX_INSUMOS_INICIALES = 30;

/** Una fila del formulario: los números viajan como texto mientras se escriben. */
export interface InsumoRow {
  /** Clave estable de la fila para React; no se envía. */
  key: string;
  nombre: string;
  disponible: string;
  requerido: string;
}

export interface InsumoRowErrors {
  nombre?: string;
  disponible?: string;
  requerido?: string;
}

export interface CenterFormValues {
  nombre: string;
  ubicacion: Ubicacion | null;
  insumos: InsumoRow[];
}

export interface CenterFormErrors {
  nombre?: string;
  ubicacion?: string;
  /** Error de la lista completa (vacía o demasiado larga). */
  insumos?: string;
  /** Errores por fila, indexados por `InsumoRow.key`. */
  filas?: Record<string, InsumoRowErrors>;
}

let rowSequence = 0;

/** Una fila vacía con una clave única. */
export function emptyInsumoRow(): InsumoRow {
  rowSequence += 1;
  return { key: `insumo-${rowSequence}`, nombre: '', disponible: '', requerido: '' };
}

/** Deja solo dígitos: los campos de cantidad no aceptan signos ni decimales. */
export function onlyDigits(text: string): string {
  return text.replace(/\D/g, '');
}

/** Entero no negativo escrito solo con dígitos, o `null`. */
function parseCantidad(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Valida una fila. `otherNames` son los nombres (en minúscula) de las demás
 * filas o de los insumos que el centro ya tiene, para rechazar repetidos.
 */
export function validateInsumoRow(
  row: InsumoRow,
  otherNames: readonly string[] = [],
): InsumoRowErrors {
  const errors: InsumoRowErrors = {};
  const nombre = row.nombre.trim();
  if (!nombre) {
    errors.nombre = 'Escribe el nombre del insumo.';
  } else if (nombre.length > MAX_NOMBRE_INSUMO) {
    errors.nombre = `El nombre no puede superar los ${MAX_NOMBRE_INSUMO} caracteres.`;
  } else if (otherNames.includes(nombre.toLowerCase())) {
    errors.nombre = 'Ese insumo ya está en la lista.';
  }

  const disponible = parseCantidad(row.disponible);
  if (disponible === null || disponible > MAX_CANTIDAD) {
    errors.disponible = 'Escribe cuántas unidades tienes hoy (0 o más).';
  }

  const requerido = parseCantidad(row.requerido);
  if (requerido === null || requerido < 1 || requerido > MAX_CANTIDAD) {
    errors.requerido = 'Escribe el máximo que necesita el centro (1 o más).';
  }
  return errors;
}

/** Convierte una fila ya válida en el insumo que espera la API; `null` si no lo es. */
export function buildInsumoInput(row: InsumoRow): NuevoInsumoInput | null {
  if (Object.keys(validateInsumoRow(row)).length > 0) {
    return null;
  }
  return {
    nombre: row.nombre.trim(),
    disponible: Number(row.disponible.trim()),
    requerido: Number(row.requerido.trim()),
  };
}

/** Valida el formulario completo de creación del centro. */
export function validateCenterForm(values: CenterFormValues): CenterFormErrors {
  const errors: CenterFormErrors = {};
  const nombre = values.nombre.trim();
  if (!nombre) {
    errors.nombre = 'Escribe el nombre del centro.';
  } else if (nombre.length > MAX_NOMBRE_CENTRO) {
    errors.nombre = `El nombre no puede superar los ${MAX_NOMBRE_CENTRO} caracteres.`;
  }

  if (!values.ubicacion) {
    errors.ubicacion =
      'Indica dónde queda el centro: usa tu ubicación actual o elige una dirección.';
  }

  if (values.insumos.length === 0) {
    errors.insumos = 'Agrega al menos un insumo.';
  } else if (values.insumos.length > MAX_INSUMOS_INICIALES) {
    errors.insumos = `Crea el centro con máximo ${MAX_INSUMOS_INICIALES} insumos; agrega los demás después.`;
  }

  const filas: Record<string, InsumoRowErrors> = {};
  values.insumos.forEach((row, index) => {
    const previous = values.insumos
      .slice(0, index)
      .map((other) => other.nombre.trim().toLowerCase())
      .filter((name) => name !== '');
    const rowErrors = validateInsumoRow(row, previous);
    if (Object.keys(rowErrors).length > 0) {
      filas[row.key] = rowErrors;
    }
  });
  if (Object.keys(filas).length > 0) {
    errors.filas = filas;
  }
  return errors;
}

/**
 * `true` cuando queda algún mensaje. Una clave presente con valor `undefined`
 * (un error que se limpió al corregir el campo) no cuenta como error.
 */
export function hasErrors(errors: CenterFormErrors | InsumoRowErrors): boolean {
  return Object.values(errors).some((value) => {
    if (value === undefined) {
      return false;
    }
    return typeof value === 'string' || Object.keys(value).length > 0;
  });
}

/** Construye el cuerpo de la creación; `null` si el formulario no es válido. */
export function buildCenterInput(values: CenterFormValues): CrearMiCentroInput | null {
  if (hasErrors(validateCenterForm(values)) || !values.ubicacion) {
    return null;
  }
  const items: NuevoInsumoInput[] = [];
  for (const row of values.insumos) {
    const item = buildInsumoInput(row);
    if (!item) {
      return null;
    }
    items.push(item);
  }
  return { nombre: values.nombre.trim(), ubicacion: values.ubicacion, items };
}

/**
 * Cantidad a retirar acotada a lo que hay: nunca menos de 1 ni más que el
 * disponible. Con el insumo en cero no hay nada que retirar y devuelve 0.
 */
export function clampWithdrawal(amount: number, disponible: number): number {
  if (disponible <= 0) {
    return 0;
  }
  if (!Number.isFinite(amount)) {
    return 1;
  }
  return Math.min(Math.max(1, Math.trunc(amount)), disponible);
}
