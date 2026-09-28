import type { EmergencyLevel, Ubicacion } from '../../types/domain';
import type { EstadoSolicitudWire, SolicitudPayload, SolicitudWireFrame } from './messages';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The six lifecycle literals the backend `EstadoSolicitud` enum can emit. */
const ESTADOS: readonly EstadoSolicitudWire[] = [
  'PENDIENTE',
  'ASIGNADA',
  'CONFIRMADA',
  'TOMADA',
  'RECHAZADA',
  'TIMEOUT',
];

function isEstado(value: unknown): value is EstadoSolicitudWire {
  return typeof value === 'string' && ESTADOS.includes(value as EstadoSolicitudWire);
}

/**
 * Validates the backend `flota` request push (`SolicitudPushPayload`) and maps
 * it to `SolicitudWireFrame`. Returns null on a malformed frame (a missing or
 * mistyped field, an unknown `estado`, a non-string notification list) and
 * NEVER throws, so an unexpected payload is dropped instead of crashing the
 * driver inbox. Boundary convention shared with `fromWireEmergency` and
 * `fromWireInventario`: validate, translate, never a blind cast.
 */
export function fromWireSolicitud(value: unknown): SolicitudWireFrame | null {
  if (!isRecord(value)) {
    return null;
  }

  const {
    solicitudId,
    emergenciaId,
    zonaId,
    estado,
    ambulanciasNotificadas,
    ambulanciaAsignadaId,
    llegada,
  } = value;

  if (typeof solicitudId !== 'string' || solicitudId.length === 0) {
    return null;
  }
  if (typeof emergenciaId !== 'string' || emergenciaId.length === 0) {
    return null;
  }
  if (typeof zonaId !== 'string') {
    return null;
  }
  if (!isEstado(estado)) {
    return null;
  }
  if (
    !Array.isArray(ambulanciasNotificadas) ||
    !ambulanciasNotificadas.every((id) => typeof id === 'string')
  ) {
    return null;
  }
  // The backend sends JSON `null` while the request is PENDIENTE. An absent
  // field is accepted as the same "no winner yet" and never invented.
  if (
    ambulanciaAsignadaId !== null &&
    ambulanciaAsignadaId !== undefined &&
    typeof ambulanciaAsignadaId !== 'string'
  ) {
    return null;
  }
  // Arrival is an optional milestone flag; anything other than a boolean is a
  // malformed frame rather than a value to coerce.
  if (llegada !== undefined && typeof llegada !== 'boolean') {
    return null;
  }

  return {
    solicitudId,
    emergenciaId,
    zonaId,
    estado,
    ambulanciasNotificadas: [...ambulanciasNotificadas],
    ambulanciaAsignadaId: typeof ambulanciaAsignadaId === 'string' ? ambulanciaAsignadaId : null,
    ...(llegada === true ? { llegada: true } : {}),
  };
}

/**
 * Context the front resolves on its side before turning a wire frame into a
 * union frame. The backend push has no scene, type or severity, so those come
 * from the emergency (`emergenciaId`) when the map data stage knows it.
 */
export interface WireSolicitudContext {
  /** Unit receiving the frame; the winner when the frame omits one. */
  ownAmbulanceId: string;
  /** Requester scene resolved from the emergency store, when available. */
  escena?: Ubicacion;
  /** Emergency description, used as the request type label when available. */
  tipo?: string;
  /** Emergency severity, when available; omitted means "Sin clasificar". */
  nivel?: EmergencyLevel;
}

/**
 * Reconciles a validated backend frame with the front's `SolicitudPayload`
 * union:
 *
 *   PENDIENTE  -> solicitud.broadcast (open request for this driver)
 *   ASIGNADA   -> request.taken        (this per-user copy IS the winner)
 *   CONFIRMADA -> request.confirmed    (citizen closed the loop)
 *   RECHAZADA  -> request.rejected     (this driver's decline was recorded)
 *   TOMADA     -> request.closed       (service finished; drop the stale card)
 *   TIMEOUT    -> request.expired      (no winner; the request is no longer active)
 *
 * A frame flagged `llegada` is the arrival milestone the winning unit emits:
 * it becomes `request.arrived` regardless of the lifecycle `estado` (which
 * stays ASIGNADA), and no new lifecycle state is introduced.
 *
 * The union's `escena`/`tipo`/`nivel` are filled from the context or left
 * absent; `timeoutEn` is '' when the backend declared no deadline, which the
 * inbox already treats as "no window known" and falls back to its default.
 */
export function solicitudFrameFromWire(
  frame: SolicitudWireFrame,
  context: WireSolicitudContext,
): SolicitudPayload | null {
  if (frame.llegada === true) {
    return {
      type: 'request.arrived',
      requestId: frame.solicitudId,
      ambulanceId: frame.ambulanciaAsignadaId ?? context.ownAmbulanceId,
    };
  }
  switch (frame.estado) {
    case 'PENDIENTE':
      return {
        type: 'solicitud.broadcast',
        requestId: frame.solicitudId,
        emergenciaId: frame.emergenciaId,
        zonaId: frame.zonaId,
        tipo: context.tipo ?? '',
        ...(context.nivel ? { nivel: context.nivel } : {}),
        ...(context.escena ? { escena: context.escena } : {}),
        timeoutEn: '',
        notificadas: frame.ambulanciasNotificadas,
        mode: 'broadcast',
        notifiedCount: frame.ambulanciasNotificadas.length,
      };
    case 'ASIGNADA':
      return {
        type: 'request.taken',
        requestId: frame.solicitudId,
        winner: frame.ambulanciaAsignadaId ?? context.ownAmbulanceId,
      };
    case 'CONFIRMADA':
      return { type: 'request.confirmed', requestId: frame.solicitudId };
    case 'RECHAZADA':
      return {
        type: 'request.rejected',
        requestId: frame.solicitudId,
        rejected: context.ownAmbulanceId,
        reason: 'rejected',
      };
    case 'TOMADA':
      return { type: 'request.closed', requestId: frame.solicitudId };
    case 'TIMEOUT':
      return { type: 'request.expired', requestId: frame.solicitudId };
    default:
      return null;
  }
}
