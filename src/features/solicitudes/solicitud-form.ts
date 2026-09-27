import type {
  SolicitudBroadcastPayload,
  SolicitudDirectPayload,
  SolicitudMode,
} from '@/shared/realtime';
import type { Ambulancia, Emergencia, SolicitudAmbulancia } from '@/types/domain';

/** Accept window used by the demo. Matches the driver overlay default. */
export const SOLICITUD_TIMEOUT_MS = 45_000;

/**
 * Front help-center id carried by a request while the flow has no real center
 * assigned. It is a placeholder, shared by the demo projection and the REST body
 * so the two paths never drift.
 */
export const CITIZEN_CENTRO_AYUDA_ID = 'CA-CRUE';

export type BroadcastScope = 'all' | 'zone';
export type SolicitudRequestPayload = SolicitudBroadcastPayload | SolicitudDirectPayload;

export interface RequestFormValues {
  emergenciaId: string;
  mode: SolicitudMode;
  scope: BroadcastScope;
  zone: string;
  targetAmbulanceId: string;
}

export interface RequestFormErrors {
  emergenciaId?: string;
  zone?: string;
  targetAmbulanceId?: string;
  units?: string;
}

let requestCounter = 0;

/** Emergencies a request can point at (not resolved/closed). */
export function activeEmergencies(emergencies: Emergencia[]): Emergencia[] {
  return emergencies.filter(
    (item) =>
      item.estado === 'REPORTED' || item.estado === 'IN_PROGRESS' || item.estado === 'ON_HOLD',
  );
}

export function availableUnits(units: Ambulancia[]): Ambulancia[] {
  return units.filter((item) => item.estado === 'AVAILABLE');
}

export function zonesOf(units: Ambulancia[]): string[] {
  return [...new Set(units.map((item) => item.zona).filter((zone) => zone.trim() !== ''))].sort();
}

export function unitsForScope(
  units: Ambulancia[],
  scope: BroadcastScope,
  zone: string | null,
): Ambulancia[] {
  const available = availableUnits(units);
  if (scope === 'zone') {
    return available.filter((item) => item.zona === zone);
  }
  return available;
}

/** Unique-ish request id; the timestamp keeps it readable in the debug log. */
export function nextRequestId(): string {
  requestCounter += 1;
  return `REQ-${Date.now().toString(36).toUpperCase()}${requestCounter.toString(36).toUpperCase()}`;
}

export function validateRequestForm(
  values: RequestFormValues,
  emergencies: Emergencia[],
  units: Ambulancia[],
): RequestFormErrors {
  const errors: RequestFormErrors = {};
  const active = activeEmergencies(emergencies);

  if (!values.emergenciaId) {
    errors.emergenciaId = 'Select an emergency.';
  } else if (!active.some((item) => item.id === values.emergenciaId)) {
    errors.emergenciaId = 'That emergency is no longer active.';
  }

  if (values.mode === 'direct') {
    if (!values.targetAmbulanceId) {
      errors.targetAmbulanceId = 'Select the unit to notify.';
    } else if (!availableUnits(units).some((item) => item.id === values.targetAmbulanceId)) {
      errors.targetAmbulanceId = 'That unit is not available.';
    }
  } else if (values.scope === 'zone') {
    if (!values.zone.trim()) {
      errors.zone = 'Select a zone.';
    } else if (unitsForScope(units, 'zone', values.zone).length === 0) {
      errors.units = 'No available units in this zone.';
    }
  } else if (availableUnits(units).length === 0) {
    errors.units = 'No units available.';
  }

  return errors;
}

interface BuildRequestInput {
  emergencia: Emergencia;
  mode: SolicitudMode;
  scope: BroadcastScope;
  zone: string | null;
  target: Ambulancia | null;
  units: Ambulancia[];
  requestId: string;
  now?: number;
}

/**
 * Builds the /queue/solicitudes payload. `nivel`, `escena`, `timeoutEn` and
 * `notificadas` are kept so the existing driver inbox (which predates `mode`)
 * keeps working unchanged.
 */
export function buildSolicitudRequest(input: BuildRequestInput): SolicitudRequestPayload {
  const now = input.now ?? Date.now();
  const timeoutEn = new Date(now + SOLICITUD_TIMEOUT_MS).toISOString();
  const common = {
    requestId: input.requestId,
    emergenciaId: input.emergencia.id,
    tipo: input.emergencia.descripcion ?? 'Medical emergency',
    nivel: input.emergencia.nivel,
    escena: input.emergencia.ubicacion,
    timeoutEn,
    timeoutMs: SOLICITUD_TIMEOUT_MS,
  };

  if (input.mode === 'direct' && input.target) {
    return {
      type: 'solicitud.direct',
      ...common,
      zonaId: input.emergencia.zonaId,
      notificadas: [input.target.id],
      notifiedCount: 1,
      mode: 'direct',
      targetAmbulanceId: input.target.id,
    };
  }

  const notified = unitsForScope(input.units, input.scope, input.zone);
  return {
    type: 'solicitud.broadcast',
    ...common,
    zonaId:
      input.scope === 'zone' ? (input.zone ?? input.emergencia.zonaId) : input.emergencia.zonaId,
    notificadas: notified.map((item) => item.id),
    notifiedCount: notified.length,
    mode: 'broadcast',
  };
}

/** Registry row derived from a published request frame. */
export function toSolicitud(
  payload: SolicitudRequestPayload,
  now = Date.now(),
): SolicitudAmbulancia {
  return {
    id: payload.requestId,
    emergenciaId: payload.emergenciaId,
    estado: 'PENDING',
    centroAyudaId: CITIZEN_CENTRO_AYUDA_ID,
    zonaId: payload.zonaId,
    tipo: payload.tipo,
    solicitadaEn: new Date(now).toISOString(),
    timeoutEn: payload.timeoutEn,
    ambulanciasNotificadas: payload.notificadas,
    notifiedCount: payload.notifiedCount ?? payload.notificadas.length,
    ambulanciaAsignadaId: null,
  };
}
