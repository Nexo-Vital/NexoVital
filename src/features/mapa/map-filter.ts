import type { Ambulancia, CentroAyuda, Zona } from '@/types/domain';

/**
 * Citizen map layer filter (presentation only).
 *
 * The filter decides what the map is ALLOWED TO PAINT; it never decides what the
 * stores keep. A fleet (or donation, or map-source) event that arrives while its
 * layer is hidden stays in the store untouched and shows up the moment the layer
 * is toggled back on. Discarding from the store would lose the alert for good,
 * which is exactly what the acceptance criterion forbids (AC2).
 */

/** The three layer kinds the citizen map mixes together. */
export type MapFilterLayer = 'ZONA' | 'CENTRO' | 'AMBULANCIA';

/** Stable order for the control; also the source of truth for iteration. */
export const MAP_FILTER_LAYERS: MapFilterLayer[] = ['ZONA', 'CENTRO', 'AMBULANCIA'];

/** `true` means the layer is painted. All three start visible. */
export type MapFilterState = Record<MapFilterLayer, boolean>;

export const DEFAULT_MAP_FILTER: MapFilterState = {
  ZONA: true,
  CENTRO: true,
  AMBULANCIA: true,
};

/** The three layer lists the citizen map reads, kept separate from their stores. */
export interface MapLayerData {
  zonas: Zona[];
  centros: CentroAyuda[];
  ambulancias: Ambulancia[];
}

/** Per-layer item counts for the control; independent of the on/off state. */
export type MapFilterCounts = Record<MapFilterLayer, number>;

/**
 * Flips one layer and returns a new state. Pure: the input is never mutated, so
 * it is trivial to test and safe to call from a React updater.
 */
export function toggleMapFilter(filter: MapFilterState, layer: MapFilterLayer): MapFilterState {
  return { ...filter, [layer]: !filter[layer] };
}

/**
 * Returns the layers the map may paint. A hidden layer is replaced by an empty
 * list, so the map draws nothing for it while every store keeps its data. Pure:
 * the input layers are never mutated.
 */
export function applyMapFilter(filter: MapFilterState, layers: MapLayerData): MapLayerData {
  return {
    zonas: filter.ZONA ? layers.zonas : [],
    centros: filter.CENTRO ? layers.centros : [],
    ambulancias: filter.AMBULANCIA ? layers.ambulancias : [],
  };
}

/** Counts each layer's items so the control is never opaque. Pure. */
export function countMapLayers(layers: MapLayerData): MapFilterCounts {
  return {
    ZONA: layers.zonas.length,
    CENTRO: layers.centros.length,
    AMBULANCIA: layers.ambulancias.length,
  };
}

/** Where the choice lives; same plain-localStorage pattern as `layers-store`. */
export const MAP_FILTER_STORAGE_KEY = 'nexovital.map-filter';

/**
 * Reads the persisted choice, falling back to all-visible. A missing or stale
 * payload never hides a layer the user did not turn off: unknown fields are
 * dropped and missing ones default to visible. There is no shared
 * `usePersistentState` hook in this repo, so this mirrors the read/parse shape
 * `layers-store` already uses (`readPersistedLayers`).
 */
export function readPersistedMapFilter(): MapFilterState {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_MAP_FILTER };
  }
  try {
    const raw = window.localStorage.getItem(MAP_FILTER_STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_MAP_FILTER };
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return { ...DEFAULT_MAP_FILTER };
    }
    const candidate = parsed as Partial<Record<MapFilterLayer, unknown>>;
    const next: MapFilterState = { ...DEFAULT_MAP_FILTER };
    for (const layer of MAP_FILTER_LAYERS) {
      if (typeof candidate[layer] === 'boolean') {
        next[layer] = candidate[layer];
      }
    }
    return next;
  } catch {
    return { ...DEFAULT_MAP_FILTER };
  }
}

/** Persists the choice so it survives a refresh. Storage failures are swallowed. */
export function writePersistedMapFilter(filter: MapFilterState): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(MAP_FILTER_STORAGE_KEY, JSON.stringify(filter));
  } catch {
    // Storage can be unavailable (private mode); in-memory state still works.
  }
}
