import { fromWireInventario } from '@/features/recursos/inventory-api';
import { ApiError, apiFetch } from '@/services/apiClient';
import type { InventarioItem, Ubicacion } from '@/types/domain';

/**
 * Cliente del centro PROPIO del administrador de centro de ayuda
 * (`/api/v1/centros-acopio/mio`, EP-03.F1.US1).
 *
 * El servidor resuelve el centro a partir del usuario autenticado: aquí nunca se
 * envía un id de centro para crear ni para agregar insumos. Los `items` llegan
 * con la MISMA forma del inventario público, así que se validan con el mismo
 * mapper (`fromWireInventario`) y pueden entrar al estado compartido de
 * inventario sin traducción adicional.
 */
export interface MiCentro {
  id: string;
  nombre: string;
  ubicacion: Ubicacion;
  items: InventarioItem[];
}

/** Un insumo a declarar: lo que hay hoy y el máximo que el centro necesita. */
export interface NuevoInsumoInput {
  nombre: string;
  disponible: number;
  requerido: number;
}

export interface CrearMiCentroInput {
  nombre: string;
  ubicacion: Ubicacion;
  items: NuevoInsumoInput[];
}

const SHAPE_ERROR = 'El servidor devolvió un centro con una forma inesperada.';
const ITEM_SHAPE_ERROR = 'El servidor devolvió un insumo con una forma inesperada.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Valida la forma del centro del cable. Devuelve `null` ante un payload
 * malformado y nunca lanza; un insumo malformado se descarta sin tumbar el
 * resto, igual que en el inventario público.
 */
export function fromWireMiCentro(value: unknown): MiCentro | null {
  if (!isRecord(value)) {
    return null;
  }
  const { id, nombre, ubicacion, items } = value;
  if (
    typeof id !== 'string' ||
    typeof nombre !== 'string' ||
    !isRecord(ubicacion) ||
    typeof ubicacion.lat !== 'number' ||
    typeof ubicacion.lng !== 'number'
  ) {
    return null;
  }
  return {
    id,
    nombre,
    ubicacion: { lat: ubicacion.lat, lng: ubicacion.lng },
    items: Array.isArray(items)
      ? items.map(fromWireInventario).filter((item): item is InventarioItem => item !== null)
      : [],
  };
}

/**
 * Lee el centro del administrador. `null` significa "todavía no creó uno" (el
 * 404 `CENTRO_NO_REGISTRADO` del backend), que es un estado normal y no un
 * error. Cualquier otro fallo burbujea como `ApiError`.
 */
export async function fetchMiCentro(): Promise<MiCentro | null> {
  let response: unknown;
  try {
    response = await apiFetch<unknown>('/centros-acopio/mio');
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
  const centro = fromWireMiCentro(response);
  if (!centro) {
    throw new Error(SHAPE_ERROR);
  }
  return centro;
}

/**
 * Crea el centro con sus insumos iniciales. `ApiError` no se captura: burbujea
 * para que el formulario muestre el `mensaje` del backend (400 con el dato que
 * falla, 409 si el nombre ya existe o si ya tiene un centro).
 */
export async function crearMiCentro(input: CrearMiCentroInput): Promise<MiCentro> {
  const response = await apiFetch<unknown>('/centros-acopio/mio', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  const centro = fromWireMiCentro(response);
  if (!centro) {
    throw new Error(SHAPE_ERROR);
  }
  return centro;
}

/** Declara un insumo nuevo en el centro del administrador. */
export async function agregarInsumo(input: NuevoInsumoInput): Promise<InventarioItem> {
  const response = await apiFetch<unknown>('/centros-acopio/mio/inventario', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  const item = fromWireInventario(response);
  if (!item) {
    throw new Error(ITEM_SHAPE_ERROR);
  }
  return item;
}

/**
 * Retira unidades de un insumo. Es el DESPACHO que ya existe
 * (`POST /centros-acopio/{id}/inventario/despacho`), con su descuento atómico:
 * si otro retiro se llevó las unidades primero, el backend responde 409
 * `STOCK_INSUFICIENTE` y aquí burbujea con su mensaje.
 */
export async function retirarInsumo(
  centroId: string,
  itemId: string,
  cantidad: number,
  motivo?: string,
): Promise<InventarioItem> {
  const response = await apiFetch<unknown>(`/centros-acopio/${centroId}/inventario/despacho`, {
    method: 'POST',
    body: JSON.stringify(motivo ? { itemId, cantidad, motivo } : { itemId, cantidad }),
  });
  const item = fromWireInventario(response);
  if (!item) {
    throw new Error(ITEM_SHAPE_ERROR);
  }
  return item;
}
