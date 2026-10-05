import type { Emergencia, EmergencyType } from '@/types/domain';

/**
 * The closed list of emergency types the citizen can report (EP-02.F1.US3:
 * "reporto la zona indicando tipo de emergencia y ubicación"). The order here is
 * the order of the select; `OTHER` stays last because it is the escape hatch for
 * anything outside the catalog.
 *
 * It mirrors the backend enum `TipoEmergencia` one to one; the Spanish wire
 * literals live in `emergency-wire.ts`, the only module that knows them.
 */
export const EMERGENCY_TYPE_OPTIONS: readonly EmergencyType[] = [
  'FLOOD',
  'FIRE',
  'LANDSLIDE',
  'EARTHQUAKE',
  'ACCIDENT',
  'OTHER',
];

/** Spanish labels: the citizen and driver UIs are Spanish. */
export const EMERGENCY_TYPE_LABELS: Record<EmergencyType, string> = {
  FLOOD: 'Inundación',
  FIRE: 'Incendio',
  LANDSLIDE: 'Derrumbe',
  EARTHQUAKE: 'Sismo',
  ACCIDENT: 'Accidente',
  OTHER: 'Otro',
};

/**
 * Hover text of an emergency marker: the reported type and the citizen's
 * comment. An emergency without a type (demo fixtures, frames that predate the
 * field) falls back to the comment alone, and to an empty title when it has
 * neither.
 */
export function emergencyTitle(emergency: Pick<Emergencia, 'tipo' | 'descripcion'>): string {
  const type = emergency.tipo ? EMERGENCY_TYPE_LABELS[emergency.tipo] : '';
  const comment = emergency.descripcion?.trim() ?? '';
  return [type, comment].filter(Boolean).join(' · ');
}
