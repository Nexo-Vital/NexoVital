import { afterEach, describe, expect, it } from 'vitest';
import type { Ambulancia, CentroAyuda, Zona } from '@/types/domain';
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

function zona(id: string): Zona {
  return {
    id,
    nombre: `Zona ${id}`,
    ubicacion: { lat: 4.7, lng: -74.0 },
    contorno: [
      { lat: 4.7, lng: -74.0 },
      { lat: 4.8, lng: -74.0 },
      { lat: 4.75, lng: -74.1 },
    ],
  };
}

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
  zonas: [zona('Z-1'), zona('Z-2')],
  centros: [centro('C-1')],
  ambulancias: [amb('A-1'), amb('A-2'), amb('A-3')],
};

describe('map-filter', () => {
  afterEach(() => {
    window.localStorage.removeItem(MAP_FILTER_STORAGE_KEY);
  });

  it('starts with the three layers visible', () => {
    expect(DEFAULT_MAP_FILTER).toEqual({ ZONA: true, CENTRO: true, AMBULANCIA: true });
  });

  it('keeps every layer when nothing is filtered', () => {
    const visible = applyMapFilter(DEFAULT_MAP_FILTER, LAYERS);

    expect(visible).toEqual(LAYERS);
    // Unfiltered layers keep their identity, so the map is not handed new arrays.
    expect(visible.zonas).toBe(LAYERS.zonas);
    expect(visible.centros).toBe(LAYERS.centros);
    expect(visible.ambulancias).toBe(LAYERS.ambulancias);
  });

  it('empties exactly the hidden layers and never mutates the input (AC1)', () => {
    const onlyAmbulances: MapFilterState = { ZONA: false, CENTRO: false, AMBULANCIA: true };

    const visible = applyMapFilter(onlyAmbulances, LAYERS);

    expect(visible.zonas).toEqual([]);
    expect(visible.centros).toEqual([]);
    expect(visible.ambulancias).toBe(LAYERS.ambulancias);
    // The source lists are untouched: this is presentation, not data loss (FD-1).
    expect(LAYERS.zonas).toHaveLength(2);
    expect(LAYERS.centros).toHaveLength(1);
    expect(LAYERS.ambulancias).toHaveLength(3);
  });

  it('toggles one layer without mutating the previous state', () => {
    const next = toggleMapFilter(DEFAULT_MAP_FILTER, 'AMBULANCIA');

    expect(next).toEqual({ ZONA: true, CENTRO: true, AMBULANCIA: false });
    expect(DEFAULT_MAP_FILTER).toEqual({ ZONA: true, CENTRO: true, AMBULANCIA: true });
    expect(toggleMapFilter(next, 'AMBULANCIA')).toEqual(DEFAULT_MAP_FILTER);
  });

  it('counts each layer regardless of visibility', () => {
    expect(countMapLayers(LAYERS)).toEqual({ ZONA: 2, CENTRO: 1, AMBULANCIA: 3 });
  });

  it('round-trips the choice through local storage', () => {
    const filter: MapFilterState = { ZONA: true, CENTRO: false, AMBULANCIA: false };

    writePersistedMapFilter(filter);

    expect(readPersistedMapFilter()).toEqual(filter);
  });

  it('falls back to all-visible when nothing or garbage is stored', () => {
    expect(readPersistedMapFilter()).toEqual(DEFAULT_MAP_FILTER);

    window.localStorage.setItem(MAP_FILTER_STORAGE_KEY, 'not-json');
    expect(readPersistedMapFilter()).toEqual(DEFAULT_MAP_FILTER);

    window.localStorage.setItem(
      MAP_FILTER_STORAGE_KEY,
      JSON.stringify({ ZONA: 'nope', CENTRO: true }),
    );
    // Unknown field dropped, missing layers default to visible.
    expect(readPersistedMapFilter()).toEqual({ ZONA: true, CENTRO: true, AMBULANCIA: true });
  });
});
