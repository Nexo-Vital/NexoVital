import { fromWireSolicitudAmbulancia } from '@/features/solicitudes/solicitud-api';
import { apiFetch } from '@/services/apiClient';
import type { SolicitudAmbulancia } from '@/types/domain';

/**
 * Body of `POST /api/v1/solicitudes/{id}/accept|reject`, mirroring the backend
 * `AceptarSolicitudRequest` / `RechazarSolicitudRequest` records exactly:
 * `{ambulanciaId}`. The unit is the one the server notified; the backend also
 * verifies it belongs to the authenticated driver.
 */
export interface ResponderSolicitudBody {
  ambulanciaId: string;
}

/**
 * Outcome of an accept over the write port. The backend answers `200` with
 * `{ganador, solicitud}`; `ganador=false` is the lost CAS, which the controller
 * turns into a `409 CAS_PERDIDO` before this module ever sees it. As a result
 * `winner` is always true for a parsed body today — the flag is read rather than
 * assumed so a future server-side change is not silently misreported.
 */
export interface AcceptOutcome {
  winner: boolean;
  solicitud: SolicitudAmbulancia;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Validates the backend `AceptarSolicitudResponse` (`{ganador, solicitud}`) and
 * maps the nested request through the SAME `fromWireSolicitudAmbulancia` the
 * citizen side uses if the nested request is already a valid
 * `SolicitudAmbulancia` (no `{ganador, solicitud}` wrapper). Returns `null` on a
 * malformed body and NEVER throws, matching the boundary convention: validate,
 * translate, never a blind cast.
 *
 * The backend `SolicitudAmbulanciaDto` has no `tipo`, so `fromWireSolicitudAmbulancia`
 * leaves it empty; the driver inbox fills it from its own active broadcast.
 */
export function fromWireAceptacion(value: unknown): AcceptOutcome | null {
  if (!isRecord(value) || typeof value.ganador !== 'boolean') {
    return null;
  }
  const solicitud = fromWireSolicitudAmbulancia(value.solicitud);
  if (!solicitud) {
    return null;
  }
  return { winner: value.ganador, solicitud };
}

/**
 * Driver accept through the contract endpoint `POST /api/v1/solicitudes/{id}/accept`.
 *
 * `apiFetch` attaches the `Content-Type` and the `Bearer` token; the response is
 * normalized through `fromWireAceptacion`, so the caller adopts the SERVER's
 * request, never a blind cast. `ApiError` is intentionally NOT caught here: the
 * caller decides what to do with the backend outcome (409 CAS lost, 409
 * `SOLICITUD_NO_ASIGNABLE` when the unit is not the driver's, 404 ...).
 */
export async function aceptarSolicitud(
  requestId: string,
  ambulanciaId: string,
): Promise<AcceptOutcome> {
  const body: ResponderSolicitudBody = { ambulanciaId };
  const response = await apiFetch<unknown>(`/solicitudes/${requestId}/accept`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  const outcome = fromWireAceptacion(response);
  if (!outcome) {
    throw new Error('El servidor devolvió una aceptación con una forma inesperada.');
  }
  return outcome;
}

/**
 * Driver reject through the contract endpoint `POST /api/v1/solicitudes/{id}/reject`.
 *
 * The backend answers `200` with the still-PENDIENTE `SolicitudAmbulanciaDto`
 * (a per-unit decline does not close the request, AC4), validated through the
 * shared `fromWireSolicitudAmbulancia`. An `ApiError` bubbles up uncaught.
 */
export async function rechazarSolicitud(
  requestId: string,
  ambulanciaId: string,
): Promise<SolicitudAmbulancia> {
  const body: ResponderSolicitudBody = { ambulanciaId };
  const response = await apiFetch<unknown>(`/solicitudes/${requestId}/reject`, {
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
 * Driver finish through `POST /api/v1/solicitudes/{id}/finalizar`.
 *
 * The backend closes the request (ASIGNADA/CONFIRMADA → TOMADA) AND returns the
 * assigned unit to available in the SAME atomic operation, so the SERVER is the
 * truth for both. The `{ambulanciaId}` body is the same as accept/reject/llegada;
 * the backend verifies the unit is the one assigned to the request and belongs
 * to the authenticated driver. The response is the closed TOMADA request,
 * validated through the shared `fromWireSolicitudAmbulancia`. An `ApiError`
 * bubbles up uncaught: the caller decides what to show.
 */
export async function finalizarSolicitud(
  requestId: string,
  ambulanciaId: string,
): Promise<SolicitudAmbulancia> {
  const body: ResponderSolicitudBody = { ambulanciaId };
  const response = await apiFetch<unknown>(`/solicitudes/${requestId}/finalizar`, {
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
 * Driver arrival declaration through `POST /api/v1/solicitudes/{id}/llegada`.
 *
 * The backend records the arrival as a milestone on the still-ASIGNADA request
 * (it is idempotent), so the response is the server's request carrying
 * `llegadaEn`. The same `{ambulanciaId}` body as accept/reject is used; the
 * backend verifies the unit is the assigned one and belongs to the driver.
 * `ApiError` bubbles up uncaught: the caller decides what to show.
 */
export async function declararLlegada(
  requestId: string,
  ambulanciaId: string,
): Promise<SolicitudAmbulancia> {
  const body: ResponderSolicitudBody = { ambulanciaId };
  const response = await apiFetch<unknown>(`/solicitudes/${requestId}/llegada`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  const solicitud = fromWireSolicitudAmbulancia(response);
  if (!solicitud) {
    throw new Error('El servidor devolvió una solicitud con una forma inesperada.');
  }
  return solicitud;
}
