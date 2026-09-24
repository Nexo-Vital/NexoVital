import { parseLatitude, parseLongitude } from '@/lib/geo';
import type { EmergencyLevel } from '@/types/domain';
import type { ReportarEmergenciaInput } from './emergency-api';

/**
 * Citizen report form values. Unlike the CRUE form, it has NO `zonaId` and no
 * client-generated `id`: the server resolves the zone and assigns the id (FW-4).
 */
export interface CitizenReportValues {
  nivel: EmergencyLevel;
  descripcion: string;
  lat: string;
  lng: string;
}

export interface CitizenReportErrors {
  descripcion?: string;
  lat?: string;
  lng?: string;
}

/**
 * The backend column is `@Column(nullable = false, length = 500)`, and a longer
 * value fails at persist time as a generic 500 with no hint of what to fix. Bounding
 * it here turns that into an actionable field error.
 */
export const MAX_DESCRIPCION = 500;

/** Validates the required description and the coordinates via the shared parsers. */
export function validateCitizenReport(values: CitizenReportValues): CitizenReportErrors {
  const errors: CitizenReportErrors = {};
  const descripcion = values.descripcion.trim();
  if (!descripcion) {
    errors.descripcion = 'La descripción es obligatoria.';
  } else if (descripcion.length > MAX_DESCRIPCION) {
    errors.descripcion = `La descripción no puede superar los ${MAX_DESCRIPCION} caracteres.`;
  }
  if (parseLatitude(values.lat) === null) {
    errors.lat = 'La latitud debe ser un número entre -90 y 90.';
  }
  if (parseLongitude(values.lng) === null) {
    errors.lng = 'La longitud debe ser un número entre -180 y 180.';
  }
  return errors;
}

/**
 * Builds the `reportarEmergencia` input; `null` when the coordinates are invalid.
 * It never invents `id`, `estado` or `zonaId` (FW-4).
 */
export function buildCitizenReportInput(
  values: CitizenReportValues,
): ReportarEmergenciaInput | null {
  const lat = parseLatitude(values.lat);
  const lng = parseLongitude(values.lng);
  if (lat === null || lng === null) {
    return null;
  }
  return {
    ubicacion: { lat, lng },
    nivel: values.nivel,
    descripcion: values.descripcion.trim(),
  };
}
