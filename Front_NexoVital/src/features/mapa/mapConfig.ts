import type { Ubicacion } from '@/types/domain';

/** Bogotá city center (approx). */
export const BOGOTA_CENTER: Ubicacion = { lat: 4.653, lng: -74.06 };

export const MAP_ZOOM = 12;

/**
 * MapLibre builds its tile-worker URL at runtime, so Vite cannot emit the file
 * on its own. The `nexovital:maplibre-worker-assets` plugin copies the worker to
 * the build root; MapCanvas points MapLibre at it via `setWorkerUrl` before any
 * map is created.
 */
export const MAPLIBRE_WORKER_URL = '/maplibre-gl-worker.mjs';

/** Base map choices exposed by the layer switcher. */
export type BaseLayer = 'dark' | 'light' | 'satellite';

export interface VectorBaseLayerConfig {
  kind: 'vector';
  id: BaseLayer;
  label: string;
  /** MapLibre style URL (keyless, no registration). */
  styleUrl: string;
  attribution: string;
}

export interface RasterBaseLayerConfig {
  kind: 'raster';
  id: BaseLayer;
  label: string;
  url: string;
  attribution: string;
  maxZoom: number;
}

export type BaseLayerConfig = VectorBaseLayerConfig | RasterBaseLayerConfig;

/**
 * OpenMapTiles requires its own attribution in addition to OpenStreetMap's.
 * OpenFreeMap asks for a link back as well, so all three are credited.
 */
export const VECTOR_ATTRIBUTION =
  '&copy; <a href="https://openfreemap.org/" target="_blank" rel="noreferrer">OpenFreeMap</a> ' +
  '&copy; <a href="https://openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a> ' +
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';

export const SATELLITE_ATTRIBUTION =
  'Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community';

/**
 * Every basemap URL + attribution lives here so a provider swap is a one-line
 * change and no component hardcodes a URL.
 *
 * Vector basemaps use OpenFreeMap (keyless MapLibre GL styles). Satellite is
 * raster because no keyless vector satellite style exists.
 *
 * NOTE (legal): Esri World Imagery is keyless and works without registration,
 * but its Terms of Use are not meant for production redistribution — treat it
 * as a demo / "legally gray" source. The safe non-commercial alternative is the
 * EOX Sentinel-2 cloudless WMS, e.g.
 * https://tiles.maps.eox.at/wms?service=WMS&request=GetMap&layers=s2cloudless-2020
 */
export const BASE_LAYERS: Record<BaseLayer, BaseLayerConfig> = {
  dark: {
    kind: 'vector',
    id: 'dark',
    label: 'Dark',
    styleUrl: 'https://tiles.openfreemap.org/styles/dark',
    attribution: VECTOR_ATTRIBUTION,
  },
  light: {
    kind: 'vector',
    id: 'light',
    label: 'Light',
    styleUrl: 'https://tiles.openfreemap.org/styles/positron',
    attribution: VECTOR_ATTRIBUTION,
  },
  satellite: {
    kind: 'raster',
    id: 'satellite',
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: SATELLITE_ATTRIBUTION,
    maxZoom: 19,
  },
};

/** Other keyless OpenFreeMap styles, kept handy for one-line swaps. */
export const ALTERNATE_VECTOR_STYLES = {
  fiord: 'https://tiles.openfreemap.org/styles/fiord',
  bright: 'https://tiles.openfreemap.org/styles/bright',
} as const;

export function baseLayerLabel(layer: BaseLayer): string {
  return BASE_LAYERS[layer].label;
}
