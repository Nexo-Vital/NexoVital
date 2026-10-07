import { fromWireSolicitudAmbulancia } from '@/features/solicitudes/solicitud-api';
import { apiFetch } from '@/services/apiClient';
import type { SolicitudAmbulancia } from '@/types/domain';

/**
 * Reads the open requests the authenticated driver can still answer from the
 * server-scoped `GET /api/v1/flota/ambulancias/mia/solicitudes/pendientes`
 * (EP-04.F2.US1, D6).
 *
 * The request push (`/user/queue/solicitudes`) is not replayed: whatever the
 * broker published while this driver had no session never arrives. This read is
 * how a driver who reloaded the page, or lost the channel for a moment, gets
 * back the requests that are still waiting for an answer.
 *
 * The server only returns requests that are still PENDIENTE, whose accept
 * window is still open and that were notified to the caller's unit, oldest
 * first. It answers an empty list while the unit is disconnected or busy, and
 * JSON `null` when the driver drives no unit; both degrade to an empty list
 * here. A real failure throws the backend `ApiError` unchanged.
 *
 * Each row goes through the SAME `fromWireSolicitudAmbulancia` the rest of the
 * app uses, so a malformed row is dropped rather than cast.
 */
export async function fetchSolicitudesPendientes(): Promise<SolicitudAmbulancia[]> {
  const body = await apiFetch<unknown>('/flota/ambulancias/mia/solicitudes/pendientes');
  if (!Array.isArray(body)) {
    return [];
  }
  return body
    .map(fromWireSolicitudAmbulancia)
    .filter((solicitud): solicitud is SolicitudAmbulancia => solicitud !== null);
}
