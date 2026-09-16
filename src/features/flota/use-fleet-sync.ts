import { useEffect } from 'react';
import { DESTINATIONS, type RealtimePort } from '@/shared/realtime';
import type { AmbulanceState, Ambulancia, Ubicacion } from '@/types/domain';
import { useFleetStore } from './fleet-store';

const AMBULANCE_STATES: AmbulanceState[] = ['AVAILABLE', 'ASSIGNED', 'EN_ROUTE', 'MAINTENANCE'];

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
  const id = payload.ambulanceId;
  if (typeof id !== 'string' || !isUbicacion(payload.ubicacion)) {
    return;
  }
  const ubicacion = payload.ubicacion;
  const existing = useFleetStore.getState().units.find((item) => item.id === id);
  const estado = isAmbulanceState(payload.estado)
    ? payload.estado
    : (existing?.estado ?? 'EN_ROUTE');
  const base: Ambulancia = existing ?? {
    id,
    placa: 'TBD',
    estado,
    ubicacion,
    zona: 'Unassigned',
    driverName: 'Unassigned',
  };
  const heading =
    typeof payload.heading === 'number' || payload.heading === null
      ? payload.heading
      : base.heading;
  const source =
    payload.source === 'device' || payload.source === 'simulated' ? payload.source : base.source;
  upsert({ ...base, ubicacion, estado, heading, source });
}

/**
 * Subscribes to /topic/flota and UPSERTS every frame into the fleet store.
 *
 * Two frame kinds share the destination:
 *   - CRUD frames (`fleet.upsert` / `fleet.delete`) from the fleet manager;
 *   - legacy live-position frames (`ambulanceId` + `ubicacion`) from drivers.
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
