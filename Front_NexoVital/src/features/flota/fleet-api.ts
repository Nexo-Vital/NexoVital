import { apiFetch } from '@/services/apiClient';
import type { AmbulanceState, Ambulancia, Ubicacion } from '@/types/domain';

/** Contract literal of a unit state (Spanish) -> UI `AmbulanceState` (English). */
const ESTADO_TO_AMBULANCE_STATE: Record<string, AmbulanceState> = {
  DISPONIBLE: 'AVAILABLE',
  EN_MISION: 'ASSIGNED',
  EN_RUTA: 'EN_ROUTE',
  MANTENIMIENTO: 'MAINTENANCE',
};

/**
 * Unit exactly as `GET /api/v1/flota/ambulancias` returns it (backend
 * `AmbulanciaDto`): identity, state, position and zone, plus the signal of its
 * position feed (EP-04.F1.US1). The driver id is deliberately NOT part of this
 * projection (the read is authenticated for every role), so a driver resolves
 * its OWN unit from `GET /api/v1/flota/ambulancias/mia` instead.
 */
export interface AmbulanciaDto {
  id: string;
  placa: string;
  estado: string;
  ubicacion: Ubicacion;
  zona: string;
  /** `true` while the unit has gone longer than the threshold without reporting. */
  sinSenal?: boolean;
  /** ISO instant of the last accepted report; `null` if it never reported. */
  ultimaPosicionEn?: string | null;
  /** Row version of this snapshot; the `/topic/flota` frames carry the same counter. */
  version?: number;
  /** `false` while the driver is disconnected from the service (EP-04.F2.US1). */
  conectada?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isEstado(value: unknown): value is AmbulanceState {
  return typeof value === 'string' && value in ESTADO_TO_AMBULANCE_STATE;
}

/**
 * Validates one wire unit and maps it to the front's `Ambulancia`. Returns
 * `null` on a malformed unit and NEVER throws, so one bad row cannot drop the
 * whole fleet (the boundary convention shared with `fromWireInventario`).
 *
 * `modelo`/`tipo` are not part of the DTO: they stay absent (the UI
 * omits them) instead of being invented. The signal fields are carried only
 * when the server sends them with the right type, so a backend that predates
 * them still maps to the same unit as before. The same holds for `conectada`.
 */
export function fromWireAmbulancia(value: unknown): Ambulancia | null {
  if (!isRecord(value)) {
    return null;
  }
  const {
    id,
    placa,
    estado,
    ubicacion,
    zona,
    sinSenal,
    ultimaPosicionEn,
    version,
    conectada,
    conductorNombre,
  } = value;
  if (typeof id !== 'string' || id.length === 0) {
    return null;
  }
  if (typeof placa !== 'string' || typeof zona !== 'string') {
    return null;
  }
  if (!isEstado(estado)) {
    return null;
  }
  if (
    !isRecord(ubicacion) ||
    typeof ubicacion.lat !== 'number' ||
    typeof ubicacion.lng !== 'number'
  ) {
    return null;
  }
  const unidad: Ambulancia = {
    id,
    placa,
    estado: ESTADO_TO_AMBULANCE_STATE[estado],
    ubicacion: { lat: ubicacion.lat, lng: ubicacion.lng },
    zona,
    // The driver's display name the server now sends; empty when unknown.
    driverName: typeof conductorNombre === 'string' ? conductorNombre : '',
  };
  if (typeof sinSenal === 'boolean') {
    unidad.sinSenal = sinSenal;
  }
  if (typeof ultimaPosicionEn === 'string' || ultimaPosicionEn === null) {
    unidad.ultimaPosicionEn = ultimaPosicionEn;
  }
  if (typeof version === 'number') {
    unidad.version = version;
  }
  if (typeof conectada === 'boolean') {
    unidad.conectada = conectada;
  }
  return unidad;
}

/**
 * Reads the fleet read-model. `apiFetch` attaches the Bearer token. The
 * response is normalized through `fromWireAmbulancia`; malformed rows are
 * dropped rather than cast.
 */
export async function fetchFlota(): Promise<Ambulancia[]> {
  const dtos = await apiFetch<unknown>('/flota/ambulancias');
  if (!Array.isArray(dtos)) {
    return [];
  }
  return dtos.map(fromWireAmbulancia).filter((unidad): unidad is Ambulancia => unidad !== null);
}

/**
 * Reads the authenticated driver's OWN unit from the server-scoped
 * `GET /api/v1/flota/ambulancias/mia`. The backend answers with the caller's
 * unit or JSON `null` when the driver has none, so `null` is a valid "no unit"
 * result and never an invented unit. This replaces resolving the unit from the
 * general fleet list, which no longer exposes any driver id (FIX3).
 */
export async function fetchMiAmbulancia(): Promise<Ambulancia | null> {
  const dto = await apiFetch<unknown>('/flota/ambulancias/mia');
  return fromWireAmbulancia(dto);
}

/**
 * Reports the position of the driver's OWN unit:
 * `POST /api/v1/flota/ambulancias/{id}/posicion` (EP-04.F1.US1, D1).
 *
 * This is the ONLY way a position enters the system. The realtime channel is
 * one-way (server -> clients): the server persists the report and it is the
 * server that publishes it on `/topic/flota`, so every client and every late
 * reader sees the same position. The source is not in the body: the route
 * always speaks for a device.
 *
 * `heading` travels as a whole number of degrees (the backend field is an
 * integer) or `null` when the device does not know it.
 */
export async function reportarPosicion(
  ambulanciaId: string,
  ubicacion: Ubicacion,
  heading: number | null,
): Promise<void> {
  await apiFetch<unknown>(`/flota/ambulancias/${encodeURIComponent(ambulanciaId)}/posicion`, {
    method: 'POST',
    body: JSON.stringify({
      ubicacion: { lat: ubicacion.lat, lng: ubicacion.lng },
      heading: heading === null ? null : Math.round(heading),
    }),
  });
}

/**
 * Connects the driver's OWN unit to the service:
 * `POST /api/v1/flota/ambulancias/mia/conectar` (EP-04.F2.US1, D3).
 *
 * The server resolves the unit from the authenticated driver, so no unit id is
 * sent. The command is repeatable: connecting a connected unit changes nothing.
 * The response is the unit as the server holds it after the command, or `null`
 * when the driver drives no unit.
 */
export async function conectarMiAmbulancia(): Promise<Ambulancia | null> {
  const dto = await apiFetch<unknown>('/flota/ambulancias/mia/conectar', { method: 'POST' });
  return fromWireAmbulancia(dto);
}

/**
 * Disconnects the driver's OWN unit:
 * `POST /api/v1/flota/ambulancias/mia/desconectar` (EP-04.F2.US1, D3).
 *
 * A unit that is attending a request cannot be disconnected: the server answers
 * 409 `SOLICITUD_EN_CURSO` and `apiFetch` throws that `ApiError` unchanged, so
 * the caller shows the server's own reason. Otherwise the response is the unit
 * after the command, or `null` when the driver drives no unit.
 */
export async function desconectarMiAmbulancia(): Promise<Ambulancia | null> {
  const dto = await apiFetch<unknown>('/flota/ambulancias/mia/desconectar', { method: 'POST' });
  return fromWireAmbulancia(dto);
}

/**
 * Declares whether the driver's OWN unit is available for requests:
 * `POST /api/v1/flota/ambulancias/mia/disponibilidad` (EP-04.F2.US1).
 *
 * `false` takes the unit out of service and `true` brings it back. Only an
 * available unit receives a new request, so this is how a connected driver
 * stops receiving them without disconnecting. A unit that is attending a
 * request cannot change it: the server answers 409 `SOLICITUD_EN_CURSO` and
 * `apiFetch` throws that `ApiError` unchanged. Otherwise the response is the
 * unit after the command, or `null` when the driver drives no unit.
 */
export async function declararDisponibilidadMiAmbulancia(
  disponible: boolean,
): Promise<Ambulancia | null> {
  const dto = await apiFetch<unknown>('/flota/ambulancias/mia/disponibilidad', {
    method: 'POST',
    body: JSON.stringify({ disponible }),
  });
  return fromWireAmbulancia(dto);
}
