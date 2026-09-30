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
 * `AmbulanciaDto`): identity, state, position and zone. The driver id is
 * deliberately NOT part of this projection (the read is authenticated for every
 * role), so a driver resolves its OWN unit from `GET
 * /api/v1/flota/ambulancias/mia` instead.
 */
export interface AmbulanciaDto {
  id: string;
  placa: string;
  estado: string;
  ubicacion: Ubicacion;
  zona: string;
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
 * `modelo`/`tipo`/`driverName` are not part of the DTO: they stay absent (the UI
 * omits them) instead of being invented.
 */
export function fromWireAmbulancia(value: unknown): Ambulancia | null {
  if (!isRecord(value)) {
    return null;
  }
  const { id, placa, estado, ubicacion, zona } = value;
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
  return {
    id,
    placa,
    estado: ESTADO_TO_AMBULANCE_STATE[estado],
    ubicacion: { lat: ubicacion.lat, lng: ubicacion.lng },
    zona,
    driverName: '',
  };
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
