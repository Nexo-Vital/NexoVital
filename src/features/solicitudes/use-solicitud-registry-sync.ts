import { useEffect } from 'react';
import { DESTINATIONS, type RealtimePort } from '@/shared/realtime';
import { type SolicitudRequestPayload, toSolicitud } from './solicitud-form';
import { useSolicitudesStore } from './solicitudes-store';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRequestFrame(payload: Record<string, unknown>): boolean {
  return (
    typeof payload.requestId === 'string' &&
    typeof payload.emergenciaId === 'string' &&
    typeof payload.zonaId === 'string' &&
    typeof payload.tipo === 'string' &&
    typeof payload.timeoutEn === 'string' &&
    Array.isArray(payload.notificadas)
  );
}

/**
 * Keeps the CRUE request registry in sync with /queue/solicitudes:
 *   - a published request (broadcast or direct) is upserted as PENDING, so a
 *     request created on another client appears here too;
 *   - `request.taken` applies the arbiter decision (the CRUE never picks it);
 *   - `request.arrived` records the winning unit's arrival milestone;
 *   - `request.confirmed` closes the request as CONFIRMED;
 *   - `request.cancelled` drops a withdrawn request, so the coordinator does not
 *     keep seeing as pending a request nobody is asking for anymore.
 */
export function useSolicitudRegistrySync(port: RealtimePort | null): void {
  useEffect(() => {
    if (!port) {
      return;
    }
    return port.subscribe(DESTINATIONS.solicitudes, (payload) => {
      if (!isRecord(payload)) {
        return;
      }
      if (
        (payload.type === 'solicitud.broadcast' || payload.type === 'solicitud.direct') &&
        isRequestFrame(payload)
      ) {
        useSolicitudesStore
          .getState()
          .upsert(toSolicitud(payload as unknown as SolicitudRequestPayload));
        return;
      }
      if (
        payload.type === 'request.taken' &&
        typeof payload.requestId === 'string' &&
        typeof payload.winner === 'string'
      ) {
        useSolicitudesStore.getState().markTaken(payload.requestId, payload.winner);
        return;
      }
      if (payload.type === 'request.arrived' && typeof payload.requestId === 'string') {
        useSolicitudesStore.getState().markArrived(payload.requestId);
        return;
      }
      if (payload.type === 'request.confirmed' && typeof payload.requestId === 'string') {
        useSolicitudesStore.getState().markConfirmed(payload.requestId);
        return;
      }
      if (payload.type === 'request.cancelled' && typeof payload.requestId === 'string') {
        useSolicitudesStore.getState().remove(payload.requestId);
      }
    });
  }, [port]);
}
