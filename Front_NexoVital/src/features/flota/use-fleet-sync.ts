import { useEffect } from 'react';
import { DESTINATIONS, type RealtimePort } from '@/shared/realtime';
import type { AmbulanceState, Ambulancia, Ubicacion } from '@/types/domain';
import { isStaleVersion, useFleetStore } from './fleet-store';

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
  // Row version of the write this frame announces (EP-04.F1.US1, D6). The dev
  // relay and a state frame the server could not version send none.
  const version = typeof payload.version === 'number' ? payload.version : undefined;
  // `sinSenal` and `ultimaPosicionEn` travel on the position frame only; a
  // state frame says nothing about the signal, so `undefined` means "keep".
  const sinSenal = typeof payload.sinSenal === 'boolean' ? payload.sinSenal : undefined;
  const ultimaPosicionEn =
    typeof payload.ultimaPosicionEn === 'string' || payload.ultimaPosicionEn === null
      ? payload.ultimaPosicionEn
      : undefined;
  // `conectada` travels on the connection frame only (EP-04.F2.US1): neither a
  // state change nor a position report changes it, so `undefined` means "keep".
  const conectada = typeof payload.conectada === 'boolean' ? payload.conectada : undefined;

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
      // The realtime frame (`PosicionPushPayload` / `FlotaActualizadaEvent`)
      // carries NO plate, so it is genuinely unknown for a unit first seen here.
      // An empty plate is the honest "unknown": `unitPlateLabel` then falls back
      // to the id, a handle the user can still recognise, instead of an invented
      // 'TBD' that pretends to be a plate.
      placa: '',
      estado,
      ubicacion: incoming,
      zona: 'Unassigned',
      driverName: '',
      heading,
      source,
      sinSenal,
      ultimaPosicionEn,
      ...(conectada === undefined ? {} : { conectada }),
      version,
    });
    return;
  }

  // D6: the pushes leave the server after commit, each on its own thread, so
  // two writes on the same unit can arrive inverted. A frame older than what
  // the store already holds is dropped WHOLE: applying it would paint a stale
  // position, a stale state or a "sin señal" the unit already left behind.
  if (isStaleVersion(existing.version, version)) {
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
  upsert({
    ...existing,
    ubicacion,
    estado,
    heading,
    source,
    sinSenal: sinSenal ?? existing.sinSenal,
    ultimaPosicionEn: ultimaPosicionEn === undefined ? existing.ultimaPosicionEn : ultimaPosicionEn,
    ...(conectada === undefined ? {} : { conectada }),
    version: version ?? existing.version,
  });
}

/**
 * Subscribes to /topic/flota and UPSERTS every frame into the fleet store.
 *
 * Three frame kinds share the destination:
 *   - CRUD frames (`fleet.upsert` / `fleet.delete`) from the fleet manager;
 *   - position frames (`ambulanceId` + `ubicacion`) published by the backend on
 *     every report, simulated or from a device. The signal-loss notice is one of
 *     them: same shape, `sinSenal: true` and the last known position;
 *   - state-change frames (`ambulanciaId` + `estado`, no position) published by
 *     the backend on every fleet transition (assignment, finish, ...). The
 *     connection frame is one of them: same shape plus `conectada`.
 *
 * The backend frames carry the row `version`, and a frame older than the one the
 * store holds is discarded (EP-04.F1.US1, D6).
 *
 * Because the store is an upsert, a unit created on another device shows up
 * here even though it was never part of the local fixtures.
 */
export function useFleetSync(port: RealtimePort | null): void {
  const upsert = useFleetStore((state) => state.upsert);
  const remove = useFleetStore((state) => state.remove);
  const forgetVersions = useFleetStore((state) => state.forgetVersions);

  useEffect(() => {
    if (!port) {
      return;
    }
    // A version only orders the frames of ONE uninterrupted subscription. What
    // the store holds from before this one (another screen, an earlier visit)
    // and what it holds when the channel drops cannot be trusted to be newer
    // than what comes next, so its versions are forgotten at both moments. The
    // snapshot read on mount and on reconnect then merges by version against
    // the frames of THIS subscription only.
    forgetVersions();
    const stopState = port.onStateChange((state) => {
      if (state !== 'CONNECTED') {
        forgetVersions();
      }
    });
    const stopFlota = port.subscribe(DESTINATIONS.flota, (payload) => {
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
    return () => {
      stopState();
      stopFlota();
    };
  }, [port, upsert, remove, forgetVersions]);
}
