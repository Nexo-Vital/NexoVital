import { fromWireSolicitudAmbulancia } from '@/features/solicitudes/solicitud-api';
import { apiFetch } from '@/services/apiClient';
import type { SolicitudAmbulancia } from '@/types/domain';

/**
 * Reads ONE request from `GET /api/v1/solicitudes/{id}` (EP-04.F2.US3): the
 * detail a notified driver opens.
 *
 * What the console shows of a request comes from the realtime notice, which is
 * not replayed and can be older than the request's real state. This read is the
 * server's own answer at the moment the driver opens the detail: the pickup
 * point, when it was raised, until when it can be answered, the notified units
 * and the current state.
 *
 * The server answers only to the driver whose unit was notified of the request
 * or has it assigned: 403 `SOLICITUD_NO_NOTIFICADA` otherwise and 404
 * `SOLICITUD_NO_ENCONTRADA` for an unknown id. Both bubble up as the backend
 * `ApiError`, unchanged, so the caller decides what to do with the row.
 *
 * The body goes through the SAME `fromWireSolicitudAmbulancia` the rest of the
 * app uses: a malformed body is `null`, never a blind cast.
 */
export async function fetchSolicitudDetalle(
  requestId: string,
): Promise<SolicitudAmbulancia | null> {
  const body = await apiFetch<unknown>(`/solicitudes/${encodeURIComponent(requestId)}`);
  return fromWireSolicitudAmbulancia(body);
}
