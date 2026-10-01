import { fromWireSolicitudAmbulancia } from '@/features/solicitudes/solicitud-api';
import { apiFetch } from '@/services/apiClient';
import type { SolicitudAmbulancia } from '@/types/domain';

/**
 * Reads the authenticated driver's service history from the server-scoped
 * `GET /api/v1/flota/ambulancias/mia/solicitudes`.
 *
 * The backend answers with the requests that were actually ASSIGNED to the
 * caller's unit, newest first by `solicitadaEn`. It answers JSON `null` when the
 * driver drives no unit — the same "no unit" signal `GET .../mia` uses — which is
 * a valid empty history, never an error. `apiFetch` attaches the Bearer token and
 * lets the backend `ApiError` (401/403/500) bubble up unchanged, so the caller
 * shows the server's own code and message.
 *
 * Each row is validated through the SAME `fromWireSolicitudAmbulancia` the rest
 * of the app uses, so a malformed row is dropped rather than cast and the
 * lifecycle vocabulary never drifts. Order is preserved: the server already
 * returns newest first and this module never re-sorts it.
 */
export async function fetchHistorialSolicitudes(): Promise<SolicitudAmbulancia[]> {
  const body = await apiFetch<unknown>('/flota/ambulancias/mia/solicitudes');
  // `null` (driver without a unit) and any non-array body degrade to an empty
  // history instead of crashing the screen; a real failure already threw above.
  if (!Array.isArray(body)) {
    return [];
  }
  return body
    .map(fromWireSolicitudAmbulancia)
    .filter((solicitud): solicitud is SolicitudAmbulancia => solicitud !== null);
}
