import { useEffect } from 'react';
import { DESTINATIONS, type RealtimePort } from '@/shared/realtime';
import type { AmbulanceState, Ambulancia, Ubicacion } from '@/types/domain';
import { useFleetStore } from './fleet-store';

const AMBULANCE_STATES: AmbulanceState[] = ['AVAILABLE', 'ASSIGNED', 'EN_ROUTE', 'MAINTENANCE'];

/**
 * Backend domain enum name (Spanish) -> UI `AmbulanceState` (English). The
 * state-only frame (`FlotaActualizadaEvent` -> `/topic/flota`) carries the raw
 * enum name, so the front must bridge it exactly like `fleet-api` does for REST.
 */
const ESTADO_TO_AMBULANCE_STATE: Record<string, AmbulanceState> = {
  DISPONIBLE: 'AVAILABLE',
  EN_MISION: 'ASSIGNED',
  EN_RUTA: 'EN_ROUTE',
  MANTENIMIENTO: 'MAINTENANCE',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isUbicacion(value: unknown): value is Ubicacion {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.lat === 'number' && typeof value.lng === 'number';
}

function isAmbulanceState(value: unknown): value is AmbulanceState {
  return typeof value === 'string' && AMBULANCE_STATES.includes(value as AmbulanceState);
}

/**
 * Accepts both state spellings the destination uses: the English
 * `AmbulanceState` of the live-position frame and the Spanish domain enum name
 * of the state-only frame. Returns `null` when neither applies.
 */
function toAmbulanceState(value: unknown): AmbulanceState | null {
  if (typeof value !== 'string') {
    return null;
  }
  if (isAmbulanceState(value)) {
    return value;
  }
  return ESTADO_TO_AMBULANCE_STATE[value] ?? null;
}

function isAmbulancia(value: unknown): value is Ambulancia {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === 'string' &&
    typeof value.driverName === 'string' &&
    isAmbulanceState(value.estado) &&
    isUbicacion(value.ubicacion)
  );
}

function applyLivePosition(
  payload: Record<string, unknown>,
  upsert: (unit: Ambulancia) => void,
): void {
  // Two producers share the destination: the position feed spells the id
  // `ambulanceId` (English), the state-change feed `ambulanciaId` (Spanish).
  const rawId =
    typeof payload.ambulanceId === 'string' ? payload.ambulanceId : payload.ambulanciaId;
  if (typeof rawId !== 'string') {
    return;
  }
  const existing = useFleetStore.getState().units.find((item) => item.id === rawId);
  const incoming = isUbicacion(payload.ubicacion) ? payload.ubicacion : null;

  // A frame with no position can only refresh a unit already known (a state
  // change); with neither a known unit nor a position there is nothing to anchor.
  if (existing === undefined) {
    if (incoming === null) {
      return;
    }
    const estado = toAmbulanceState(payload.estado) ?? 'EN_ROUTE';
    const heading =
      typeof payload.heading === 'number' || payload.heading === null ? payload.heading : undefined;
    const source =
      payload.source === 'device' || payload.source === 'simulated' ? payload.source : undefined;
    upsert({
      id: rawId,
      placa: 'TBD',
      estado,
      ubicacion: incoming,
      zona: 'Unassigned',
      driverName: 'Unassigned',
      heading,
      source,
    });
    return;
  }

  const estado = toAmbulanceState(payload.estado) ?? existing.estado;
  const ubicacion = incoming ?? existing.ubicacion;
  const heading =
    typeof payload.heading === 'number' || payload.heading === null
      ? payload.heading
      : existing.heading;
  const source =
    payload.source === 'device' || payload.source === 'simulated'
      ? payload.source
      : existing.source;
  upsert({ ...existing, ubicacion, estado, heading, source });
}

/**
 * Subscribes to /topic/flota and UPSERTS every frame into the fleet store.
 *
 * Three frame kinds share the destination:
 *   - CRUD frames (`fleet.upsert` / `fleet.delete`) from the fleet manager;
 *   - legacy live-position frames (`ambulanceId` + `ubicacion`) from drivers;
 *   - state-change frames (`ambulanciaId` + `estado`, no position) published by
 *     the backend on every fleet transition (assignment, finish, ...).
 *
 * Because the store is an upsert, a unit created on another device shows up
 * here even though it was never part of the local fixtures.
 */
export function useFleetSync(port: RealtimePort | null): void {
  const upsert = useFleetStore((state) => state.upsert);
  const remove = useFleetStore((state) => state.remove);

  useEffect(() => {
    if (!port) {
      return;
    }
    return port.subscribe(DESTINATIONS.flota, (payload) => {
      if (!isRecord(payload)) {
        return;
      }
      if (payload.type === 'fleet.upsert' && isAmbulancia(payload.unit)) {
        upsert(payload.unit);
        return;
      }
      if (payload.type === 'fleet.delete' && typeof payload.ambulanceId === 'string') {
        remove(payload.ambulanceId);
        return;
      }
      applyLivePosition(payload, upsert);
    });
  }, [port, upsert, remove]);
}
