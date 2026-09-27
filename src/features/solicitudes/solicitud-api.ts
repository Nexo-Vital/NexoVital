import { apiFetch } from '@/services/apiClient';
import type { EstadoSolicitudWire } from '@/shared/realtime';
import type { RequestState, SolicitudAmbulancia } from '@/types/domain';

/**
 * Body of `POST /api/v1/solicitudes`, mirroring the backend `SolicitudRequest`
 * record exactly: `{emergenciaId, centroAyudaId, zonaId, timeoutEn}`.
 *
 * `timeoutEn` is optional: the backend falls back to its configured accept
 * window when it is absent.
 */
export interface SolicitudRequestBody {
  emergenciaId: string;
  centroAyudaId: string;
  zonaId: string;
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
 * `tipo` is NOT part of the DTO, so it is left empty here; the caller fills it
 * from its own request label instead of this mapper inventing one.
 */
export function fromWireSolicitudAmbulancia(value: unknown): SolicitudAmbulancia | null {
  if (!isRecord(value)) {
    return null;
  }

  const {
    id,
    emergenciaId,
    estado,
    centroAyudaId,
    zonaId,
    solicitadaEn,
    timeoutEn,
    ambulanciasNotificadas,
    ambulanciaAsignadaId,
  } = value;

  if (typeof id !== 'string' || id.length === 0) {
    return null;
  }
  if (typeof emergenciaId !== 'string' || emergenciaId.length === 0) {
    return null;
  }
  if (!isEstado(estado)) {
    return null;
  }
  if (typeof centroAyudaId !== 'string') {
    return null;
  }
  if (typeof zonaId !== 'string') {
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

  return {
    id,
    emergenciaId,
    estado: ESTADO_TO_REQUEST_STATE[estado],
    centroAyudaId,
    zonaId,
    tipo: '',
    solicitadaEn,
    timeoutEn,
    ambulanciasNotificadas: [...ambulanciasNotificadas],
    notifiedCount: ambulanciasNotificadas.length,
    ambulanciaAsignadaId: typeof ambulanciaAsignadaId === 'string' ? ambulanciaAsignadaId : null,
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
