import { parseLatitude, parseLongitude } from '@/lib/geo';
import type { Emergencia, EmergencyLevel } from '@/types/domain';

export interface EmergencyFormValues {
  nivel: EmergencyLevel;
  zonaId: string;
  descripcion: string;
  lat: string;
  lng: string;
}

export interface EmergencyFormErrors {
  zonaId?: string;
  descripcion?: string;
  lat?: string;
  lng?: string;
}

const ID_PATTERN = /^EMG-(\d+)$/;

/** Next free auto id, e.g. EMG-006 when EMG-001..EMG-005 exist. */
export function nextEmergencyId(emergencies: Emergencia[]): string {
  let max = 0;
  for (const item of emergencies) {
    const match = ID_PATTERN.exec(item.id);
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  }
  return `EMG-${String(max + 1).padStart(3, '0')}`;
}

export function validateEmergencyForm(values: EmergencyFormValues): EmergencyFormErrors {
  const errors: EmergencyFormErrors = {};
  if (!values.zonaId.trim()) {
    errors.zonaId = 'Zone is required.';
  }
  if (!values.descripcion.trim()) {
    errors.descripcion = 'Description is required.';
  }
  if (parseLatitude(values.lat) === null) {
    errors.lat = 'Latitude must be a number between -90 and 90.';
  }
  if (parseLongitude(values.lng) === null) {
    errors.lng = 'Longitude must be a number between -180 and 180.';
  }
  return errors;
}

/** Builds the reported emergency; null when the coordinates are invalid. */
export function buildEmergency(
  values: EmergencyFormValues,
  id: string,
  now = Date.now(),
): Emergencia | null {
  const lat = parseLatitude(values.lat);
  const lng = parseLongitude(values.lng);
  if (lat === null || lng === null) {
    return null;
  }
  return {
    id,
    ubicacion: { lat, lng },
    nivel: values.nivel,
    estado: 'REPORTED',
    descripcion: values.descripcion.trim(),
    zonaId: values.zonaId.trim(),
    createdAt: new Date(now).toISOString(),
  };
}
