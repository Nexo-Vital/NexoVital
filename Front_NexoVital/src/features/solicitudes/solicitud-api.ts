import { apiFetch } from '@/services/apiClient';
import type { EstadoSolicitudWire } from '@/shared/realtime';
import type { RequestState, SolicitudAmbulancia, Ubicacion } from '@/types/domain';

/**
 * Body of `POST /api/v1/solicitudes`, mirroring the backend `SolicitudRequest`
 * record: `{ubicacion, emergenciaId?, centroAyudaId?, zonaId?, timeoutEn?}`.
 *
 * `ubicacion` is the pickup point and the only mandatory field. The emergency,
 * the aid center and the zone are optional context: a citizen request no longer
 * depends on an affected zone. `timeoutEn` is optional too — the backend falls
 * back to its configured accept window when it is absent.
 */
export interface SolicitudRequestBody {
  ubicacion: Ubicacion;
  emergenciaId?: string;
  centroAyudaId?: string;
  zonaId?: string;
  timeoutEn?: string;
}

/** Contract estado (Spanish) -> UI `RequestState` (English). */
const ESTADO_TO_REQUEST_STATE: Record<EstadoSolicitudWire, RequestState> = {
  PENDIENTE: 'PENDING',
  ASIGNADA: 'ASSIGNED',
  CONFIRMADA: 'CONFIRMED',
  TOMADA: 'TAKEN',
  RECHAZADA: 'REJECTED',
  TIMEOUT: 'TIMEOUT',
  CANCELADA: 'CANCELLED',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Own-key check: never lets a prototype key ("toString") read as a wire literal. */
function isEstado(value: unknown): value is EstadoSolicitudWire {
  return typeof value === 'string' && Object.keys(ESTADO_TO_REQUEST_STATE).includes(value);
}

/** A non-empty string that parses as a real timestamp. */
function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

/** Optional id: a non-empty string, or `null`/absent. Anything else is malformed. */
function isOptionalId(value: unknown): value is string | null {
  return value === null || value === undefined || (typeof value === 'string' && value.length > 0);
}

/** A `{lat, lng}` pair of finite numbers, or null when absent/malformed. */
function asUbicacion(value: unknown): Ubicacion | null {
  if (
    !isRecord(value) ||
    typeof value.lat !== 'number' ||
    typeof value.lng !== 'number' ||
    !Number.isFinite(value.lat) ||
    !Number.isFinite(value.lng)
  ) {
    return null;
  }
  return { lat: value.lat, lng: value.lng };
}

/**
 * Validates the backend `SolicitudAmbulanciaDto` returned by
 * `POST /api/v1/solicitudes` and maps it to the front's `SolicitudAmbulancia`.
 *
 * The server is the source of truth for `id`, `estado`, `solicitadaEn` and
 * `timeoutEn`; this boundary only translates the Spanish `estado` to English and
 * copies the rest. Returns `null` on a malformed payload and NEVER throws, so an
 * unexpected body is dropped instead of being stored as a half request (the same
 * boundary convention as `fromWireSolicitud` and `fromWireInventario`).
 *
 * `ubicacion` is the request's own pickup point and is required by the DTO.
 * `emergenciaId`, `centroAyudaId` and `zonaId` are nullable: a standalone request
 * sends none. `tipo` is NOT part of the DTO, so it is left empty here; the caller
 * fills it from its own request label instead of this mapper inventing one.
 * `llegadaEn` is carried through when the DTO declares the arrival milestone, so
 * the service history can show it without a second, drifting mapping.
 * `ambulanciasRechazaron` lists the units that declined the request; absent
 * reads as an empty list.
 */
export function fromWireSolicitudAmbulancia(value: unknown): SolicitudAmbulancia | null {
  if (!isRecord(value)) {
    return null;
  }

  const {
    id,
    ubicacion,
    emergenciaId,
    estado,
    centroAyudaId,
    zonaId,
    solicitadaEn,
    timeoutEn,
    ambulanciasNotificadas,
    ambulanciaAsignadaId,
    llegadaEn,
    ambulanciasRechazaron,
  } = value;

  if (typeof id !== 'string' || id.length === 0) {
    return null;
  }
  const punto = asUbicacion(ubicacion);
  if (!punto) {
    return null;
  }
  if (!isOptionalId(emergenciaId)) {
    return null;
  }
  if (!isEstado(estado)) {
    return null;
  }
  if (!isOptionalId(centroAyudaId)) {
    return null;
  }
  if (!isOptionalId(zonaId)) {
    return null;
  }
  if (!isTimestamp(solicitadaEn) || !isTimestamp(timeoutEn)) {
    return null;
  }
  if (
    !Array.isArray(ambulanciasNotificadas) ||
    !ambulanciasNotificadas.every((item) => typeof item === 'string')
  ) {
    return null;
  }
  // JSON `null` while the request is still PENDIENTE; absent is the same "no
  // winner yet" and is never invented.
  if (
    ambulanciaAsignadaId !== null &&
    ambulanciaAsignadaId !== undefined &&
    typeof ambulanciaAsignadaId !== 'string'
  ) {
    return null;
  }
  // Arrival is an optional milestone: JSON `null`/absent while the unit has not
  // declared it. A present-but-unparsable value is malformed, never coerced.
  if (llegadaEn !== null && llegadaEn !== undefined && !isTimestamp(llegadaEn)) {
    return null;
  }
  // The units that declined it (EP-04.F2.US5). A server that predates the field
  // sends none, which reads as "nobody declined"; a present value that is not a
  // list of ids is malformed.
  if (
    ambulanciasRechazaron !== null &&
    ambulanciasRechazaron !== undefined &&
    (!Array.isArray(ambulanciasRechazaron) ||
      !ambulanciasRechazaron.every((item) => typeof item === 'string'))
  ) {
    return null;
  }

  return {
    id,
    emergenciaId: typeof emergenciaId === 'string' ? emergenciaId : '',
    ubicacion: punto,
    estado: ESTADO_TO_REQUEST_STATE[estado],
    centroAyudaId: typeof centroAyudaId === 'string' ? centroAyudaId : '',
    zonaId: typeof zonaId === 'string' ? zonaId : '',
    tipo: '',
    solicitadaEn,
    timeoutEn,
    ambulanciasNotificadas: [...ambulanciasNotificadas],
    notifiedCount: ambulanciasNotificadas.length,
    ambulanciasRechazaron: Array.isArray(ambulanciasRechazaron) ? [...ambulanciasRechazaron] : [],
    ambulanciaAsignadaId: typeof ambulanciaAsignadaId === 'string' ? ambulanciaAsignadaId : null,
    ...(typeof llegadaEn === 'string' ? { llegadaEn } : {}),
  };
}

/**
 * Creates the citizen's ambulance request through the contract endpoint.
 *
 * `apiFetch` attaches the `Content-Type` and the `Bearer` token; the response is
 * normalized through `fromWireSolicitudAmbulancia`, so the returned request is
 * the server's, never a blind cast of the body.
 *
 * `ApiError` is intentionally NOT caught here: it bubbles up so the caller can
 * decide what to do with a rejected creation (409 no units, 400 invalid data).
 */
export async function solicitarAmbulancia(
  body: SolicitudRequestBody,
): Promise<SolicitudAmbulancia> {
  const response = await apiFetch<unknown>('/solicitudes', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  const solicitud = fromWireSolicitudAmbulancia(response);
  if (!solicitud) {
    throw new Error('El servidor devolvió una solicitud con una forma inesperada.');
  }
  return solicitud;
}

/**
 * Confirms the assigned unit through `POST /api/v1/solicitudes/{id}/confirmar`.
 *
 * The `flota` controller exposes the operation with NO body (a `@PathVariable`
 * only) and the requirement is derived from the authenticated user, so nothing
 * is sent. The backend answers `200` with the now-CONFIRMADA request, validated
 * through the shared `fromWireSolicitudAmbulancia`; the caller adopts the
 * server's request instead of a blind cast.
 *
 * `ApiError` is intentionally NOT caught here: the caller decides what to show
 * (404 unknown request, 409 already moved or not the requester, 403 wrong role).
 */
export async function confirmarSolicitud(requestId: string): Promise<SolicitudAmbulancia> {
  const response = await apiFetch<unknown>(`/solicitudes/${requestId}/confirmar`, {
    method: 'POST',
  });

  const solicitud = fromWireSolicitudAmbulancia(response);
  if (!solicitud) {
    throw new Error('El servidor devolvió una solicitud con una forma inesperada.');
  }
  return solicitud;
}

/**
 * Cancels the requester's own open request through
 * `POST /api/v1/solicitudes/{id}/cancelar`.
 *
 * The `flota` controller takes no body (a `@PathVariable` only) and resolves the
 * requester from the authenticated user, so nothing is sent beyond the bearer.
 * The backend answers `200` with the now-CANCELADA request, validated through the
 * shared `fromWireSolicitudAmbulancia`.
 *
 * `ApiError` is intentionally NOT caught here: the caller decides what to show
 * (409 when a unit already accepted and the ambulance is on its way, 403 when the
 * caller is not the requester, 404 unknown request).
 */
export async function cancelarSolicitud(requestId: string): Promise<SolicitudAmbulancia> {
  const response = await apiFetch<unknown>(`/solicitudes/${requestId}/cancelar`, {
    method: 'POST',
  });

  const solicitud = fromWireSolicitudAmbulancia(response);
  if (!solicitud) {
    throw new Error('El servidor devolvió una solicitud con una forma inesperada.');
  }
  return solicitud;
}
