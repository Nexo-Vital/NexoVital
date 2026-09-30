import type { Emergencia, EmergencyLevel, EmergencyStatus } from '@/types/domain';

/**
 * Wire literals as the backend speaks them (Spanish), the single module that
 * knows them. `types/domain.ts` normalizes enum VALUES to English for the UI, so
 * this is the only translation edge: the STOMP push and the POST response both
 * come through here.
 */
export type EmergencyLevelWire = 'BAJO' | 'MEDIO' | 'ALTO' | 'CRITICO';

export type EmergencyStatusWire =
  | 'REGISTRADA'
  | 'EN_ATENCION'
  | 'EN_ESPERA'
  | 'RESUELTA'
  | 'CERRADA';

/** Contract level (Spanish) -> UI level (English). */
export const EMERGENCY_LEVEL_FROM_WIRE: Record<EmergencyLevelWire, EmergencyLevel> = {
  BAJO: 'LOW',
  MEDIO: 'MEDIUM',
  ALTO: 'HIGH',
  CRITICO: 'CRITICAL',
};

/** Contract status (Spanish) -> UI status (English). */
export const EMERGENCY_STATUS_FROM_WIRE: Record<EmergencyStatusWire, EmergencyStatus> = {
  REGISTRADA: 'REPORTED',
  EN_ATENCION: 'IN_PROGRESS',
  EN_ESPERA: 'ON_HOLD',
  RESUELTA: 'RESOLVED',
  CERRADA: 'CLOSED',
};

/** UI level (English) -> contract level (Spanish), for the POST body. */
export const EMERGENCY_LEVEL_TO_WIRE: Record<EmergencyLevel, EmergencyLevelWire> = {
  LOW: 'BAJO',
  MEDIUM: 'MEDIO',
  HIGH: 'ALTO',
  CRITICAL: 'CRITICO',
};

const LEVELS: readonly EmergencyLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const STATUSES: readonly EmergencyStatus[] = [
  'REPORTED',
  'IN_PROGRESS',
  'ON_HOLD',
  'RESOLVED',
  'CLOSED',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Own-key check: never lets a prototype key ("toString") read as a wire literal. */
function owns(record: object, key: string): boolean {
  return Object.keys(record).includes(key);
}

/**
 * Translates a level, and accepts an already-English value so the same function
 * can normalize both a backend push and the local (demo) emergencies the store
 * already holds.
 */
function toLevel(value: unknown): EmergencyLevel | null {
  if (typeof value !== 'string') {
    return null;
  }
  if (owns(EMERGENCY_LEVEL_FROM_WIRE, value)) {
    return EMERGENCY_LEVEL_FROM_WIRE[value as EmergencyLevelWire];
  }
  return LEVELS.includes(value as EmergencyLevel) ? (value as EmergencyLevel) : null;
}

/** Translates a status; idempotent exactly like `toLevel`. */
function toStatus(value: unknown): EmergencyStatus | null {
  if (typeof value !== 'string') {
    return null;
  }
  if (owns(EMERGENCY_STATUS_FROM_WIRE, value)) {
    return EMERGENCY_STATUS_FROM_WIRE[value as EmergencyStatusWire];
  }
  return STATUSES.includes(value as EmergencyStatus) ? (value as EmergencyStatus) : null;
}

/**
 * Validates the wire shape of an emergency, translates its enums to English and
 * maps a `null`/absent `zonaId` to `''` (the repo convention for "no zone"; the
 * server sends null when the point falls outside the seeded catalog, D4).
 *
 * Idempotent: an already-English value passes through unchanged. Returns `null`
 * when the shape does not close and NEVER throws, so a malformed frame is
 * dropped instead of crashing the map.
 */
export function fromWireEmergency(value: unknown): Emergencia | null {
  if (!isRecord(value)) {
    return null;
  }

  const ubicacion = value.ubicacion;
  const nivel = toLevel(value.nivel);
  const estado = toStatus(value.estado);

  if (
    typeof value.id !== 'string' ||
    typeof value.createdAt !== 'string' ||
    nivel === null ||
    estado === null ||
    !isRecord(ubicacion) ||
    typeof ubicacion.lat !== 'number' ||
    typeof ubicacion.lng !== 'number'
  ) {
    return null;
  }

  const zonaId = typeof value.zonaId === 'string' ? value.zonaId : '';
  const descripcion = typeof value.descripcion === 'string' ? value.descripcion : undefined;
  // Optional like `descripcion`: carried only when the wire actually sent a
  // usable number, never invented and never defaulted. A non-number is dropped
  // (absent version), which makes the reader degrade to today's behaviour.
  const version =
    typeof value.version === 'number' && Number.isFinite(value.version) ? value.version : undefined;

  return {
    id: value.id,
    ubicacion: { lat: ubicacion.lat, lng: ubicacion.lng },
    nivel,
    estado,
    ...(descripcion === undefined ? {} : { descripcion }),
    zonaId,
    createdAt: value.createdAt,
    ...(version === undefined ? {} : { version }),
  };
}
