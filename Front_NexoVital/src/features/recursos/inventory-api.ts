import { MOCK_CENTROS_AYUDA } from '@/mocks/fixtures';
import { apiFetch, isDemoMode } from '@/services/apiClient';
import type { ItemInventarioPayload, SemaforoWire } from '@/shared/realtime';
import type { InventarioItem, TrafficLight } from '@/types/domain';

/**
 * Cliente de inventario (EP-03) para el flujo de donación del ciudadano.
 *
 * La proyección del backend es el MISMO objeto por REST y por el canal de
 * tiempo real (`/topic/suministros`): `{id, centroAcopioId, nombre, disponible,
 * requerido, semaforo}`. El contrato NO expone `unidad`, `unitDetail` ni el
 * número gramatical, así que esos campos de UI quedan ausentes en vez de
 * inventarse (la UI degrada de forma honesta).
 */
export type ItemInventarioDto = ItemInventarioPayload;

/** Semáforo del contrato (español) -> semáforo de la UI (inglés). */
const SEMAFORO_TO_TRAFFIC_LIGHT: Record<SemaforoWire, TrafficLight> = {
  ROJO: 'RED',
  AMARILLO: 'AMBER',
  VERDE: 'GREEN',
  COMPLETO: 'COMPLETE',
};

/**
 * Traduce el literal `semaforo` del backend al `TrafficLight` del front. Es una
 * traducción pura: el NIVEL lo fija el backend, nunca se recalcula en local con
 * los umbrales de `traffic-light` (esos solo quedan para los fixtures de demo y
 * la previsualización de la donación).
 */
export function trafficLightFromWire(semaforo: SemaforoWire): TrafficLight {
  return SEMAFORO_TO_TRAFFIC_LIGHT[semaforo];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSemaforo(value: unknown): value is SemaforoWire {
  return value === 'ROJO' || value === 'AMARILLO' || value === 'VERDE' || value === 'COMPLETO';
}

/**
 * Valida la forma de un item de inventario del cable y lo mapea al dominio del
 * front. Devuelve `null` ante un payload malformado y NUNCA lanza, para que un
 * frame o una entrada inesperada no rompan la lista completa.
 */
export function fromWireInventario(value: unknown): InventarioItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const { id, centroAcopioId, nombre, disponible, requerido, semaforo } = value;
  if (
    typeof id !== 'string' ||
    typeof centroAcopioId !== 'string' ||
    typeof nombre !== 'string' ||
    typeof disponible !== 'number' ||
    typeof requerido !== 'number' ||
    !isSemaforo(semaforo)
  ) {
    return null;
  }

  return {
    id,
    centroAcopioId,
    nombre,
    disponible,
    requerido,
    semaforo: trafficLightFromWire(semaforo),
    // `grammaticalNumber`, `unidad` y `unitDetail` NO vienen en la API: quedan
    // ausentes y la UI degrada de forma honesta en vez de inventarlos.
  };
}

/**
 * Inventario de demo, SIN ninguna petición: los fixtures ya traen los items, su
 * número gramatical y sus unidades. Un centro sin entrada en los fixtures
 * reporta inventario vacío, igual que un centro del backend sin nada declarado.
 */
export function demoInventario(centroId: string): InventarioItem[] {
  return MOCK_CENTROS_AYUDA.find((centro) => centro.id === centroId)?.items ?? [];
}

/**
 * Lee el inventario de un centro.
 *
 * El modo demo es una decisión de BUILD, nunca un fallback en tiempo de
 * ejecución (la misma regla de `apiClient` y `useMapData`): con la bandera
 * encendida devuelve los fixtures y no se emite ninguna petición; con ella
 * apagada pide `GET /api/v1/centros-acopio/{id}/inventario` a través de
 * `apiFetch`, que adjunta el token Bearer.
 */
export async function fetchInventario(centroId: string): Promise<InventarioItem[]> {
  if (isDemoMode()) {
    return demoInventario(centroId);
  }

  const dtos = await apiFetch<ItemInventarioDto[]>(`/centros-acopio/${centroId}/inventario`);
  if (!Array.isArray(dtos)) {
    return [];
  }
  return dtos.map(fromWireInventario).filter((item): item is InventarioItem => item !== null);
}

/** Resultado de una donación: el item acreditado y cuánto entró de lo ofrecido. */
export interface DonacionResultado {
  item: InventarioItem;
  /** Unidades que el servidor aceptó (acotadas a lo que faltaba). */
  aceptada: number;
  /** Unidades que el donante ofreció. */
  ofrecida: number;
}

/**
 * Registra una donación. El servidor la acota a lo que todavía falta
 * (`requerido - disponible`): si el donante ofrece más, solo entra lo que
 * completa la necesidad, y si otro donante ya la cubrió responde 409
 * `NECESIDAD_CUBIERTA`. El cuerpo lleva SOLO `{itemId, cantidad}`; la respuesta
 * 200 es el item acreditado más `cantidadAceptada` y `cantidadOfrecida`.
 *
 * `ApiError` no se captura a propósito: burbujea para que quien llama muestre el
 * `mensaje` del backend (400 DATOS_INVALIDOS, 409 NECESIDAD_CUBIERTA, ...).
 */
export async function registrarDonacion(
  centroId: string,
  itemId: string,
  cantidad: number,
): Promise<DonacionResultado> {
  const response = await apiFetch<unknown>(`/centros-acopio/${centroId}/inventario/donacion`, {
    method: 'POST',
    body: JSON.stringify({ itemId, cantidad }),
  });

  const item = fromWireInventario(response);
  if (!item) {
    throw new Error('El servidor devolvió un insumo con una forma inesperada.');
  }
  const wire = isRecord(response) ? response : {};
  const aceptada =
    typeof wire.cantidadAceptada === 'number' && wire.cantidadAceptada >= 0
      ? wire.cantidadAceptada
      : cantidad;
  const ofrecida =
    typeof wire.cantidadOfrecida === 'number' && wire.cantidadOfrecida >= 0
      ? wire.cantidadOfrecida
      : cantidad;
  return { item, aceptada, ofrecida };
}
