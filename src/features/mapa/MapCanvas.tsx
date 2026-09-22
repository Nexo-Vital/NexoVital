import 'leaflet/dist/leaflet.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import type {} from '@maplibre/maplibre-gl-leaflet';
import L from 'leaflet';
import { useEffect, useMemo } from 'react';
import { MapContainer, Marker, useMap, useMapEvents, ZoomControl } from 'react-leaflet';
import { filterByLevel, useLayersStore } from '@/features/mapa/layers-store';
import type { Ambulancia, CentroAyuda, Emergencia, Ubicacion } from '@/types/domain';
import {
  BASE_LAYERS,
  type BaseLayer,
  BOGOTA_CENTER,
  MAP_ZOOM,
  MAPLIBRE_WORKER_URL,
} from './mapConfig';
import { ambulanceIcon, centerIcon, emergencyIcon, selfIcon } from './markers';

/** The viewer's own unit, rendered apart from the fleet markers. */
export interface SelfMarker {
  position: Ubicacion;
  heading: number | null;
  simulated: boolean;
  /** Marker label; defaults to the driver console's SIM/YOU. */
  label?: string;
}

interface MapCanvasProps {
  ambulancias: Ambulancia[];
  emergencias: Emergencia[];
  centros?: CentroAyuda[];
  selectedAmbulanceId?: string | null;
  selectedCentroId?: string | null;
  /** Latest selection to glide to, or null to stay put. */
  focus?: Ubicacion | null;
  /** Initial map center; defaults to the city center. */
  center?: Ubicacion;
  /** Driver console: "You are here" marker, draggable while simulated. */
  self?: SelfMarker | null;
  /** Map click in lat/lng (used by tap-to-move while simulating). */
  onMapClick?: (ubicacion: Ubicacion) => void;
  /** Fired when a dragged self marker is released. */
  onSelfDragEnd?: (ubicacion: Ubicacion) => void;
  /** Reports the current map center so forms can offer "use map center". */
  onCenterChange?: (ubicacion: Ubicacion) => void;
  onSelectAmbulance: (id: string) => void;
  onSelectEmergency: (id: string) => void;
  /**
   * Fired when an aid-center marker is clicked, so the host can inspect its
   * resources. Optional: the driver console renders centres for context only.
   */
  onSelectCentro?: (id: string) => void;
}

function MapClickHandler({ onMapClick }: { onMapClick?: (ubicacion: Ubicacion) => void }) {
  useMapEvents({
    click: (event) => onMapClick?.({ lat: event.latlng.lat, lng: event.latlng.lng }),
  });
  return null;
}

function FocusController({ focus }: { focus: Ubicacion | null }) {
  const map = useMap();

  useEffect(() => {
    if (focus) {
      map.flyTo([focus.lat, focus.lng], Math.max(map.getZoom(), MAP_ZOOM), { duration: 0.4 });
    }
  }, [focus, map]);

  return null;
}

/** Emits the map center on mount and after every pan/zoom settles. */
function CenterReporter({ onCenterChange }: { onCenterChange?: (ubicacion: Ubicacion) => void }) {
  const map = useMap();
  useMapEvents({
    moveend: () => {
      const center = map.getCenter();
      onCenterChange?.({ lat: center.lat, lng: center.lng });
    },
  });

  useEffect(() => {
    if (!onCenterChange) {
      return;
    }
    const center = map.getCenter();
    onCenterChange({ lat: center.lat, lng: center.lng });
  }, [map, onCenterChange]);

  return null;
}

/**
 * MapLibre GL needs a WebGL context, which jsdom does not provide. Skipping the
 * vector basemap there keeps the smoke test (and any SSR-ish import) safe.
 */
function supportsWebGL(): boolean {
  if (typeof window === 'undefined' || typeof WebGLRenderingContext === 'undefined') {
    return false;
  }
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * Swaps the basemap by adding the layer that matches `baseLayer`: a MapLibre GL
 * vector layer for dark/light, or a keyless raster tile layer for satellite.
 * Markers and other Leaflet overlays stay untouched above it.
 */
function BaseLayerController({ baseLayer }: { baseLayer: BaseLayer }) {
  const map = useMap();

  useEffect(() => {
    const config = BASE_LAYERS[baseLayer];
    let cleanup: (() => void) | null = null;
    let disposed = false;

    if (config.kind === 'raster') {
      const raster = L.tileLayer(config.url, {
        attribution: config.attribution,
        maxZoom: config.maxZoom,
      });
      raster.addTo(map);
      cleanup = () => {
        raster.remove();
      };
    } else if (supportsWebGL()) {
      void import('@maplibre/maplibre-gl-leaflet').then(async ({ maplibreGL }) => {
        if (disposed) {
          return;
        }
        // MapLibre resolves its tile worker at runtime, so Vite never emits it.
        // Point it at the asset copied to the build root BEFORE a map is created,
        // or the vector basemap stays blank in production. Loaded dynamically so
        // only the lazy vector path pays for the ~585KB maplibre-gl bundle.
        const { setWorkerUrl } = await import('maplibre-gl');
        if (disposed) {
          return;
        }
        setWorkerUrl(MAPLIBRE_WORKER_URL);
        const vector = maplibreGL({ style: config.styleUrl, attributionControl: false });
        vector.addTo(map);
        map.attributionControl?.addAttribution(config.attribution);
        cleanup = () => {
          vector.remove();
          map.attributionControl?.removeAttribution(config.attribution);
        };
      });
    }

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [map, baseLayer]);

  return null;
}

/**
 * Full-bleed emergency map. Basemap style, overlay visibility and the emergency
 * level filter all come from the persisted layers store; every URL lives in
 * mapConfig. Positions are static mocks for this unit.
 */
export function MapCanvas({
  ambulancias,
  emergencias,
  centros = [],
  selectedAmbulanceId = null,
  selectedCentroId = null,
  focus = null,
  center = BOGOTA_CENTER,
  self = null,
  onMapClick,
  onSelfDragEnd,
  onCenterChange,
  onSelectAmbulance,
  onSelectEmergency,
  onSelectCentro,
}: MapCanvasProps) {
  const baseLayer = useLayersStore((state) => state.baseLayer);
  const overlays = useLayersStore((state) => state.overlays);
  const visibleLevels = useLayersStore((state) => state.visibleLevels);

  const visibleEmergencies = useMemo(
    () => (overlays.emergencias ? filterByLevel(emergencias, visibleLevels) : []),
    [emergencias, overlays.emergencias, visibleLevels],
  );

  return (
    <MapContainer
      className="h-full w-full"
      center={[center.lat, center.lng]}
      zoom={MAP_ZOOM}
      zoomControl={false}
      attributionControl
    >
      <BaseLayerController baseLayer={baseLayer} />
      <ZoomControl position="bottomright" />
      <FocusController focus={focus} />
      <CenterReporter onCenterChange={onCenterChange} />
      <MapClickHandler onMapClick={onMapClick} />

      {visibleEmergencies.map((emergency) => (
        <Marker
          key={emergency.id}
          position={[emergency.ubicacion.lat, emergency.ubicacion.lng]}
          icon={emergencyIcon(emergency)}
          eventHandlers={{ click: () => onSelectEmergency(emergency.id) }}
        />
      ))}

      {overlays.ambulancias &&
        ambulancias.map((ambulance) => (
          <Marker
            key={ambulance.id}
            position={[ambulance.ubicacion.lat, ambulance.ubicacion.lng]}
            icon={ambulanceIcon(ambulance, ambulance.id === selectedAmbulanceId)}
            eventHandlers={{ click: () => onSelectAmbulance(ambulance.id) }}
          />
        ))}

      {overlays.centros &&
        centros.map((center) => (
          <Marker
            key={center.id}
            position={[center.ubicacion.lat, center.ubicacion.lng]}
            icon={centerIcon(center, center.id === selectedCentroId)}
            eventHandlers={onSelectCentro ? { click: () => onSelectCentro(center.id) } : undefined}
          />
        ))}

      {self && (
        <Marker
          position={[self.position.lat, self.position.lng]}
          icon={selfIcon(self.heading, self.simulated, self.label)}
          draggable={self.simulated}
          zIndexOffset={1000}
          eventHandlers={
            onSelfDragEnd
              ? {
                  dragend: (event) => {
                    const { lat, lng } = (event.target as L.Marker).getLatLng();
                    onSelfDragEnd({ lat, lng });
                  },
                }
              : undefined
          }
        />
      )}
    </MapContainer>
  );
}
