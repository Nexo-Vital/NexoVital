import 'leaflet/dist/leaflet.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import type {} from '@maplibre/maplibre-gl-leaflet';
import L from 'leaflet';
import { useEffect, useMemo, useState } from 'react';
import {
  MapContainer,
  Marker,
  Polygon,
  Polyline,
  useMap,
  useMapEvents,
  ZoomControl,
} from 'react-leaflet';
import { filterByLevel, useLayersStore } from '@/features/mapa/layers-store';
import { cn } from '@/lib/utils';
import type { Ambulancia, CentroAyuda, Emergencia, Ubicacion, Zona } from '@/types/domain';
import {
  BASE_LAYERS,
  type BaseLayer,
  BOGOTA_CENTER,
  MAP_ZOOM,
  MAPLIBRE_WORKER_URL,
} from './mapConfig';
import {
  ambulanceIcon,
  centerIcon,
  citizenRingsIcon,
  emergencyIcon,
  requestIcon,
  selfIcon,
} from './markers';
import { outerRingRadiusKm, radarRingsPixelDiameter } from './radar-rings';
import type { Ruta } from './routing-api';
import { zoneAreaPositions, zoneForCentro } from './zone-selection';

/** The viewer's own unit, rendered apart from the fleet markers. */
export interface SelfMarker {
  position: Ubicacion;
  simulated: boolean;
  /** Marker label; defaults to the driver console's SIM/YOU. */
  label?: string;
}

/** The driver console's pending requester pin (mockup `pinReq`). */
export interface RequestMarker {
  position: Ubicacion;
  label: string;
}

/**
 * A straight line between two points. It is a VISUAL CONNECTOR between the
 * requester and the driver, not a calculated route: there is no routing engine
 * in this build, so it must never be read as a path a vehicle would follow.
 */
export interface RequestConnector {
  from: Ubicacion;
  to: Ubicacion;
  /**
   * Dashed by default (the pending-request connector). A live mission draws it
   * SOLID, the same visual difference the mockup makes between `d3` and `d4`.
   */
  dashed?: boolean;
}

interface MapCanvasProps {
  ambulancias: Ambulancia[];
  emergencias: Emergencia[];
  centros?: CentroAyuda[];
  /**
   * Active zones (`GET /api/v1/mapa`). They are NEVER all painted: only the zone
   * of the center whose detail is open is drawn, and only while it is open (see
   * `selectedZoneArea`). The zone is painted as its real footprint — a Leaflet
   * polygon built from the zone's `contorno` — never as a bare point.
   */
  zonas?: Zona[];
  selectedAmbulanceId?: string | null;
  selectedCentroId?: string | null;
  /** Center that just changed level, drawn with the mockup's "changed" halo. */
  changedCentroId?: string | null;
  /** Latest selection to glide to, or null to stay put. */
  focus?: Ubicacion | null;
  /** Initial map center; defaults to the city center. */
  center?: Ubicacion;
  /** Driver console: "You are here" marker, draggable while simulated. */
  self?: SelfMarker | null;
  /** Driver console: pending requester pin with its two static rings. */
  request?: RequestMarker | null;
  /** Driver console: decorative dashed connector, NOT a calculated route. */
  requestConnector?: RequestConnector | null;
  /**
   * Real street route (OSRM) between the assigned unit and the citizen, already
   * in Leaflet `[lat, lng]` order. When present it REPLACES the straight
   * connector: a real path must never be painted on top of a straight line
   * pretending to be one. When absent, the connector renders exactly as before
   * (AC3).
   */
  ruta?: Ruta | null;
  /** Fleet unit ids currently part of an open request (`notificadas`). */
  notifiedAmbulanceIds?: readonly string[];
  /** Fleet unit ids to de-emphasise (the units an open request did NOT alert). */
  dimmedAmbulanceIds?: readonly string[];
  /**
   * Per-unit marker label override, keyed by unit id. The citizen tracking
   * screen labels the assigned unit with its computed ETA ("A-07 · 5 min");
   * without an entry the marker keeps its plain id.
   */
  ambulanceLabels?: Readonly<Record<string, string>>;
  /**
   * Citizen search: draw the radar rings anchored on the self marker. The outer
   * radius is the real distance to the farthest unit in `notifiedAmbulanceIds`.
   */
  selfRings?: boolean;
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
 * Citizen search radar (mockup `C.c3`). The outer ring's real ground radius is
 * `outerKm`; the icon is re-sized from that distance on every settled zoom, so
 * the rings keep covering the same terrain instead of the same pixels. Leaflet
 * already scales the marker during the zoom animation, so `zoomend` is enough.
 */
function CitizenRadar({ position, outerKm }: { position: Ubicacion; outerKm: number }) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useMapEvents({
    zoomend: () => setZoom(map.getZoom()),
  });

  const sizePx = radarRingsPixelDiameter(outerKm, position.lat, zoom);
  // Memoised on the size alone: an unrelated re-render must not rebuild the
  // marker's DOM through `setIcon`.
  const icon = useMemo(() => citizenRingsIcon(sizePx), [sizePx]);

  return (
    <Marker
      position={[position.lat, position.lng]}
      icon={icon}
      zIndexOffset={-100}
      interactive={false}
    />
  );
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
  zonas = [],
  selectedAmbulanceId = null,
  selectedCentroId = null,
  changedCentroId = null,
  focus = null,
  center = BOGOTA_CENTER,
  self = null,
  request = null,
  requestConnector = null,
  ruta = null,
  notifiedAmbulanceIds = [],
  dimmedAmbulanceIds = [],
  ambulanceLabels,
  selfRings = false,
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

  /** The center whose detail is open, if any: it is the only one that reveals a zone. */
  const selectedCentro = useMemo(
    () => centros.find((centro) => centro.id === selectedCentroId) ?? null,
    [centros, selectedCentroId],
  );

  /**
   * The selected center's zone, resolved through its `zonaId`. Nothing is drawn
   * by default — the mockup's map has no zones — so an idle map stays clean.
   */
  const selectedZone = useMemo(() => zoneForCentro(zonas, selectedCentro), [zonas, selectedCentro]);

  /**
   * The selected zone's contour as Leaflet positions, or null when the zone has
   * no polygon to draw. `/api/v1/mapa` publishes each zone's `contorno`, so the
   * opened center's zone is painted as an AREA and not as a point.
   */
  const selectedZoneArea = useMemo(() => zoneAreaPositions(selectedZone), [selectedZone]);

  /**
   * Citizen search radar: only while a search is open AND at least one alerted
   * unit is on the map. The outer radius is the real distance to the farthest
   * one, so an idle map (or one whose alert reached no drawn unit) draws no ring.
   */
  const radar = useMemo(() => {
    if (!selfRings || !self) {
      return null;
    }
    const outerKm = outerRingRadiusKm(self.position, ambulancias, notifiedAmbulanceIds);
    return outerKm !== null && outerKm > 0 ? { position: self.position, outerKm } : null;
  }, [selfRings, self, ambulancias, notifiedAmbulanceIds]);

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

      {/*
        The OPENED center's zone ONLY, painted as an AREA. Zones are not drawn by
        default (the mockup's map has none): an idle map stays clean. When a
        center is selected, its own zone appears as a Leaflet polygon built from
        its contour — `/api/v1/mapa` publishes the ordered vertices that enclose
        the zone. A zone with no usable contour paints nothing (`zoneAreaPositions`):
        never draw an area the data does not have.
      */}
      {selectedZoneArea && (
        <Polygon
          key={selectedZone?.id}
          positions={selectedZoneArea}
          className="nv-zone-area"
          interactive={false}
        />
      )}

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
            icon={ambulanceIcon(
              ambulance,
              ambulance.id === selectedAmbulanceId,
              notifiedAmbulanceIds.includes(ambulance.id),
              dimmedAmbulanceIds.includes(ambulance.id),
              ambulanceLabels?.[ambulance.id],
            )}
            eventHandlers={{ click: () => onSelectAmbulance(ambulance.id) }}
          />
        ))}

      {overlays.centros &&
        centros.map((center) => (
          <Marker
            key={center.id}
            position={[center.ubicacion.lat, center.ubicacion.lng]}
            icon={centerIcon(center, center.id === selectedCentroId, center.id === changedCentroId)}
            eventHandlers={onSelectCentro ? { click: () => onSelectCentro(center.id) } : undefined}
          />
        ))}

      {/*
        Real street route (OSRM). `ruta.geometria` is already Leaflet `[lat, lng]`
        order and is drawn exactly as received: the geometry is NEVER invented. It
        keeps the connector's two-layer language (casing + line, non-interactive)
        but with its own `nv-route-*` classes so a real route is distinguishable
        from the straight connector, both in the DOM and in tests.
      */}
      {ruta && (
        <>
          <Polyline
            positions={ruta.geometria}
            className="nv-route-casing"
            weight={11}
            interactive={false}
          />
          <Polyline
            positions={ruta.geometria}
            className="nv-route-line"
            weight={6}
            lineCap="round"
            interactive={false}
          />
        </>
      )}

      {/*
        Decorative connector between the requester and the driver. It is a
        straight dashed line, NOT a calculated route, so it is drawn only when
        there is no real route to show (AC3). With a route on screen it steps
        aside rather than double-drawing the same trip.
      */}
      {!ruta && requestConnector && (
        <>
          <Polyline
            positions={[
              [requestConnector.from.lat, requestConnector.from.lng],
              [requestConnector.to.lat, requestConnector.to.lng],
            ]}
            className="nv-connector-casing"
            weight={11}
            interactive={false}
          />
          <Polyline
            positions={[
              [requestConnector.from.lat, requestConnector.from.lng],
              [requestConnector.to.lat, requestConnector.to.lng],
            ]}
            className={cn(
              'nv-connector-line',
              requestConnector.dashed === false && 'nv-connector-line--solid',
            )}
            weight={6}
            dashArray={requestConnector.dashed === false ? undefined : '1 12'}
            lineCap="round"
            interactive={false}
          />
        </>
      )}

      {request && (
        <Marker
          position={[request.position.lat, request.position.lng]}
          icon={requestIcon(request.label)}
          zIndexOffset={500}
          interactive={false}
        />
      )}

      {radar && <CitizenRadar position={radar.position} outerKm={radar.outerKm} />}

      {self && (
        <Marker
          position={[self.position.lat, self.position.lng]}
          icon={selfIcon(self.simulated, self.label)}
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
