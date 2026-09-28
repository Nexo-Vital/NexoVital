import { afterEach, describe, expect, it } from 'vitest';
import type { Ambulancia, CentroAyuda } from '@/types/domain';
import {
  applyMapFilter,
  countMapLayers,
  DEFAULT_MAP_FILTER,
  MAP_FILTER_STORAGE_KEY,
  type MapFilterState,
  type MapLayerData,
  readPersistedMapFilter,
  toggleMapFilter,
  writePersistedMapFilter,
} from './map-filter';

function centro(id: string): CentroAyuda {
  return { id, nombre: `Centro ${id}`, ubicacion: { lat: 4.7, lng: -74.0 }, items: [] };
}

function amb(id: string): Ambulancia {
  return {
    id,
    placa: `OVX-${id}`,
    estado: 'AVAILABLE',
    ubicacion: { lat: 4.7, lng: -74.0 },
    zona: 'Suba',
    driverName: `Driver ${id}`,
  };
}

const LAYERS: MapLayerData = {
  centros: [centro('C-1')],
  ambulancias: [amb('A-1'), amb('A-2'), amb('A-3')],
};

describe('map-filter', () => {
  afterEach(() => {
    window.localStorage.removeItem(MAP_FILTER_STORAGE_KEY);
  });

  it('starts with the two layers visible', () => {
    expect(DEFAULT_MAP_FILTER).toEqual({ CENTRO: true, AMBULANCIA: true });
  });

  it('keeps every layer when nothing is filtered', () => {
    const visible = applyMapFilter(DEFAULT_MAP_FILTER, LAYERS);

    expect(visible).toEqual(LAYERS);
    // Unfiltered layers keep their identity, so the map is not handed new arrays.
    expect(visible.centros).toBe(LAYERS.centros);
    expect(visible.ambulancias).toBe(LAYERS.ambulancias);
  });

  it('empties exactly the hidden layers and never mutates the input (AC1)', () => {
    const onlyAmbulances: MapFilterState = { CENTRO: false, AMBULANCIA: true };

    const visible = applyMapFilter(onlyAmbulances, LAYERS);

    expect(visible.centros).toEqual([]);
    expect(visible.ambulancias).toBe(LAYERS.ambulancias);
    // The source lists are untouched: this is presentation, not data loss (FD-1).
    expect(LAYERS.centros).toHaveLength(1);
    expect(LAYERS.ambulancias).toHaveLength(3);
  });

  it('toggles one layer without mutating the previous state', () => {
    const next = toggleMapFilter(DEFAULT_MAP_FILTER, 'AMBULANCIA');

    expect(next).toEqual({ CENTRO: true, AMBULANCIA: false });
    expect(DEFAULT_MAP_FILTER).toEqual({ CENTRO: true, AMBULANCIA: true });
    expect(toggleMapFilter(next, 'AMBULANCIA')).toEqual(DEFAULT_MAP_FILTER);
  });

  it('counts each layer regardless of visibility', () => {
    expect(countMapLayers(LAYERS)).toEqual({ CENTRO: 1, AMBULANCIA: 3 });
  });

  it('round-trips the choice through local storage', () => {
    const filter: MapFilterState = { CENTRO: false, AMBULANCIA: false };

    writePersistedMapFilter(filter);

    expect(readPersistedMapFilter()).toEqual(filter);
  });

  it('falls back to all-visible when nothing or garbage is stored', () => {
    expect(readPersistedMapFilter()).toEqual(DEFAULT_MAP_FILTER);

    window.localStorage.setItem(MAP_FILTER_STORAGE_KEY, 'not-json');
    expect(readPersistedMapFilter()).toEqual(DEFAULT_MAP_FILTER);

    window.localStorage.setItem(
      MAP_FILTER_STORAGE_KEY,
      JSON.stringify({ CENTRO: 'nope', AMBULANCIA: false }),
    );
    // Unknown field dropped, missing layer defaults to visible.
    expect(readPersistedMapFilter()).toEqual({ CENTRO: true, AMBULANCIA: false });
  });

  it('ignores a ZONA entry persisted before zones became point reports', () => {
    // A choice saved by an older build must not break the two-layer filter nor
    // resurrect a layer the map no longer paints.
    window.localStorage.setItem(
      MAP_FILTER_STORAGE_KEY,
      JSON.stringify({ ZONA: false, CENTRO: false, AMBULANCIA: true }),
    );

    expect(readPersistedMapFilter()).toEqual({ CENTRO: false, AMBULANCIA: true });
  });
});
