import { parseLatitude, parseLongitude } from '@/lib/geo';
import type { AmbulanceState, Ambulancia } from '@/types/domain';

export interface FleetFormValues {
  driverName: string;
  estado: AmbulanceState;
  lat: string;
  lng: string;
}

export interface FleetFormErrors {
  driverName?: string;
  lat?: string;
  lng?: string;
}

const ID_PATTERN = /^AMB-(\d+)$/;

/** Next free auto id, e.g. AMB-11 when AMB-01..AMB-10 exist. */
export function nextAmbulanceId(units: Ambulancia[]): string {
  let max = 0;
  for (const unit of units) {
    const match = ID_PATTERN.exec(unit.id);
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  }
  return `AMB-${String(max + 1).padStart(2, '0')}`;
}

/**
 * Validates the fleet form. Position is required when creating and skipped when
 * editing (edit only changes driver name and state).
 */
export function validateFleetForm(
  values: FleetFormValues,
  options: { requirePosition?: boolean } = {},
): FleetFormErrors {
  const { requirePosition = true } = options;
  const errors: FleetFormErrors = {};
  if (!values.driverName.trim()) {
    errors.driverName = 'Driver name is required.';
  }
  if (requirePosition) {
    if (parseLatitude(values.lat) === null) {
      errors.lat = 'Latitude must be a number between -90 and 90.';
    }
    if (parseLongitude(values.lng) === null) {
      errors.lng = 'Longitude must be a number between -180 and 180.';
    }
  }
  return errors;
}

/** Builds the new unit; null when the coordinates are invalid. */
export function buildAmbulance(values: FleetFormValues, id: string): Ambulancia | null {
  const lat = parseLatitude(values.lat);
  const lng = parseLongitude(values.lng);
  if (lat === null || lng === null) {
    return null;
  }
  return {
    id,
    placa: 'TBD',
    estado: values.estado,
    ubicacion: { lat, lng },
    zona: 'Unassigned',
    driverName: values.driverName.trim(),
  };
}
