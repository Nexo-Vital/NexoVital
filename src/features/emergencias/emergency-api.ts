import { apiFetch } from '@/services/apiClient';
import type { Emergencia, EmergencyLevel, Ubicacion } from '@/types/domain';
import { EMERGENCY_LEVEL_TO_WIRE, fromWireEmergency } from './emergency-wire';

/** The three fields `POST /emergencias` accepts; the server assigns the rest. */
export interface ReportarEmergenciaInput {
  ubicacion: Ubicacion;
  nivel: EmergencyLevel;
  descripcion: string;
}

/**
 * Reports an emergency through the contract endpoint. `apiFetch` attaches the
 * `Content-Type` and the `Bearer` token; the body carries ONLY `ubicacion`,
 * `nivel` and `descripcion` — `id`, `estado` and `zonaId` are the server's
 * authority (D2/D4). The response is normalized through `fromWireEmergency`.
 *
 * `ApiError` is intentionally NOT caught here: it bubbles up so the dialog can
 * show the backend's `mensaje`.
 */
export async function reportarEmergencia(input: ReportarEmergenciaInput): Promise<Emergencia> {
  const response = await apiFetch<unknown>('/emergencias', {
    method: 'POST',
    body: JSON.stringify({
      ubicacion: input.ubicacion,
      nivel: EMERGENCY_LEVEL_TO_WIRE[input.nivel],
      descripcion: input.descripcion,
    }),
  });

  const emergency = fromWireEmergency(response);
  if (!emergency) {
    throw new Error('El servidor devolvió una emergencia con una forma inesperada.');
  }
  return emergency;
}
