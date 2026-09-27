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
 * `AmbulanciaDto`): identity, state, position, zone and the driver user id the
 * unit is linked to. The driver resolves its OWN unit from `conductorId`.
 */
export interface AmbulanciaDto {
  id: string;
  placa: string;
  estado: string;
  ubicacion: Ubicacion;
  zona: string;
  /** Driver user id the unit belongs to; JSON `null` when it has none. */
  conductorId?: string | null;
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
 * omits them) instead of being invented. `conductorId` is carried when present
 * so a driver can recognise its own unit (FIX3).
 */
export function fromWireAmbulancia(value: unknown): Ambulancia | null {
  if (!isRecord(value)) {
    return null;
  }
  const { id, placa, estado, ubicacion, zona, conductorId } = value;
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
    ...(typeof conductorId === 'string' ? { conductorId } : {}),
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
