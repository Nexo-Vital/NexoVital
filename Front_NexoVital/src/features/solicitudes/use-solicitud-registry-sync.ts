import { useEffect } from 'react';
import { useEmergencyStore } from '@/features/emergencias/emergency-store';
import {
  DESTINATIONS,
  fromWireSolicitud,
  type RealtimePort,
  type SolicitudWireFrame,
} from '@/shared/realtime';
import type { SolicitudAmbulancia } from '@/types/domain';
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
 * Registry row from a backend `flota` frame. The wire carries no request type
 * label, so `tipo` is resolved from the emergency when the store knows it. The
 * creation frame carries no deadline either, and `timeoutEn` stays empty rather
 * than being invented; a request offered late brings its own two instants, and
 * the row keeps them.
 */
function solicitudFromWire(frame: SolicitudWireFrame): SolicitudAmbulancia {
  const emergency =
    frame.emergenciaId === null
      ? null
      : (useEmergencyStore.getState().items.find((item) => item.id === frame.emergenciaId) ?? null);
  return {
    id: frame.solicitudId,
    emergenciaId: frame.emergenciaId ?? '',
    estado: 'PENDING',
    centroAyudaId: '',
    zonaId: frame.zonaId ?? '',
    ...(frame.ubicacion ? { ubicacion: frame.ubicacion } : {}),
    tipo: emergency?.descripcion ?? '',
    solicitadaEn: frame.solicitadaEn ?? new Date().toISOString(),
    timeoutEn: frame.timeoutEn ?? '',
    ambulanciasNotificadas: frame.ambulanciasNotificadas,
    notifiedCount: frame.ambulanciasNotificadas.length,
    ambulanciaAsignadaId: frame.ambulanciaAsignadaId,
    ...(frame.direccion ? { direccion: frame.direccion } : {}),
    ...(frame.solicitanteNombre ? { solicitanteNombre: frame.solicitanteNombre } : {}),
  };
}

/**
 * Keeps the CRUE request registry in sync with /user/queue/solicitudes:
 *   - a published request (broadcast or direct, demo shape or backend wire
 *     frame) is upserted as PENDING, so a request created on another client
 *     appears here too;
 *   - `request.taken` applies the arbiter decision (the CRUE never picks it);
 *   - `request.arrived` records the winning unit's arrival milestone;
 *   - `request.confirmed` closes the request as CONFIRMED;
 *   - `request.expired` (backend TIMEOUT) and `request.closed` (backend TOMADA)
 *     are terminal: the request is no longer active and is dropped;
 *   - `request.cancelled` drops a withdrawn request, so the coordinator does not
 *     keep seeing as pending a request nobody is asking for anymore.
 */
export function useSolicitudRegistrySync(port: RealtimePort | null): void {
  useEffect(() => {
    if (!port) {
      return;
    }
    return port.subscribe<unknown>(DESTINATIONS.solicitudes, (raw) => {
      if (!isRecord(raw)) {
        return;
      }

      // Backend `flota` wire frame first: it has no `type` and its lifecycle
      // lives in `estado`. A malformed frame is dropped by the validator.
      const wire = fromWireSolicitud(raw);
      if (wire) {
        // The arrival milestone is a flag, not a lifecycle state: record it
        // without touching `estado` (the request stays ASIGNADA).
        if (wire.llegada) {
          useSolicitudesStore.getState().markArrived(wire.solicitudId);
          return;
        }
        if (wire.estado === 'PENDIENTE') {
          useSolicitudesStore.getState().upsert(solicitudFromWire(wire));
          return;
        }
        if (wire.estado === 'ASIGNADA' && wire.ambulanciaAsignadaId) {
          useSolicitudesStore.getState().markTaken(wire.solicitudId, wire.ambulanciaAsignadaId);
          return;
        }
        if (wire.estado === 'CONFIRMADA') {
          useSolicitudesStore.getState().markConfirmed(wire.solicitudId);
          return;
        }
        if (wire.estado === 'TIMEOUT' || wire.estado === 'TOMADA' || wire.estado === 'CANCELADA') {
          // Terminal whole-request states: the request is no longer active, so
          // the card is dropped instead of lingering as a stale Pending one.
          useSolicitudesStore.getState().remove(wire.solicitudId);
        }
        return;
      }

      const payload = raw;
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
        return;
      }
      if (
        (payload.type === 'request.expired' || payload.type === 'request.closed') &&
        typeof payload.requestId === 'string'
      ) {
        // Terminal states: the request is no longer active, so drop the card.
        useSolicitudesStore.getState().remove(payload.requestId);
      }
    });
  }, [port]);
}
