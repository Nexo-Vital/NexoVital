import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CENTER_LEVEL_STYLE } from '@/features/ciudadano/citizen-view';
import { ALL_LEVELS, DEFAULT_OVERLAYS, useLayersStore } from '@/features/mapa/layers-store';
import { MapCanvas } from '@/features/mapa/MapCanvas';
import type { Ruta } from '@/features/mapa/routing-api';
import { MOCK_AMBULANCIAS, MOCK_CENTROS_AYUDA, MOCK_EMERGENCIAS } from '@/mocks/fixtures';
import { GLOBALS_CSS, paletteDeclaration } from '@/test/mockup-palette';

function resetLayers() {
  useLayersStore.setState({
    baseLayer: 'dark',
    baseLayerOverridden: false,
    overlays: { ...DEFAULT_OVERLAYS },
    visibleLevels: [...ALL_LEVELS],
  });
}

/** The Suba contour the backend publishes: a closed polygon, not a single point. */
const SUBA_CONTOUR = [
  { lat: 4.79, lng: -74.1 },
  { lat: 4.795, lng: -74.05 },
  { lat: 4.755, lng: -74.032 },
  { lat: 4.7, lng: -74.05 },
  { lat: 4.685, lng: -74.075 },
  { lat: 4.735, lng: -74.135 },
  { lat: 4.775, lng: -74.125 },
];

function markerLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.nv-marker__label')).map(
    (element) => element.textContent ?? '',
  );
}

function renderMap() {
  return render(
    <MapCanvas
      ambulancias={MOCK_AMBULANCIAS}
      emergencias={MOCK_EMERGENCIAS}
      onSelectAmbulance={() => undefined}
      onSelectEmergency={() => undefined}
    />,
  );
}

function renderMapWithCenters(onSelectCentro: (id: string) => void) {
  return render(
    <MapCanvas
      ambulancias={MOCK_AMBULANCIAS}
      emergencias={MOCK_EMERGENCIAS}
      centros={MOCK_CENTROS_AYUDA}
      onSelectAmbulance={() => undefined}
      onSelectEmergency={() => undefined}
      onSelectCentro={onSelectCentro}
    />,
  );
}

function renderMapWithZones() {
  return render(
    <MapCanvas
      ambulancias={[]}
      emergencias={[]}
      zonas={[
        {
          id: 'Z-SUBA',
          nombre: 'Suba',
          ubicacion: { lat: 4.742, lng: -74.09 },
          contorno: SUBA_CONTOUR,
        },
      ]}
      onSelectAmbulance={() => undefined}
      onSelectEmergency={() => undefined}
    />,
  );
}

/** The same zones, but with the center that owns one of them selected. */
function renderMapWithSelectedZone() {
  return render(
    <MapCanvas
      ambulancias={[]}
      emergencias={[]}
      centros={[
        {
          id: 'ORG-SUBA',
          nombre: 'Acopio Suba Norte',
          zonaId: 'Z-SUBA',
          ubicacion: { lat: 4.742, lng: -74.09 },
          items: [],
        },
      ]}
      zonas={[
        {
          id: 'Z-SUBA',
          nombre: 'Suba',
          ubicacion: { lat: 4.742, lng: -74.09 },
          contorno: SUBA_CONTOUR,
        },
      ]}
      selectedCentroId="ORG-SUBA"
      onSelectAmbulance={() => undefined}
      onSelectEmergency={() => undefined}
    />,
  );
}

function renderMapWithSelf() {
  return render(
    <MapCanvas
      ambulancias={MOCK_AMBULANCIAS}
      emergencias={MOCK_EMERGENCIAS}
      self={{ position: { lat: 4.65, lng: -74.06 }, simulated: false, label: 'Tú' }}
      onSelectAmbulance={() => undefined}
      onSelectEmergency={() => undefined}
    />,
  );
}

function renderMapWithRequest() {
  return render(
    <MapCanvas
      ambulancias={MOCK_AMBULANCIAS}
      emergencias={MOCK_EMERGENCIAS}
      request={{ position: { lat: 4.63, lng: -74.07 }, label: 'Suba · 1,2 km' }}
      requestConnector={{ from: { lat: 4.65, lng: -74.06 }, to: { lat: 4.63, lng: -74.07 } }}
      notifiedAmbulanceIds={['A-15']}
      onSelectAmbulance={() => undefined}
      onSelectEmergency={() => undefined}
    />,
  );
}

/** The `.nv-marker` wrapper whose label matches, or a thrown error. */
function markerByLabel(container: HTMLElement, label: string): HTMLElement {
  const marker = Array.from(container.querySelectorAll<HTMLElement>('.nv-marker')).find(
    (element) => element.querySelector('.nv-marker__label')?.textContent === label,
  );
  if (!marker) {
    throw new Error(`marker ${label} not found`);
  }
  return marker;
}

/** The citizen search state: rings on the self marker, alerted and dimmed units. */
function renderMapWithSearch() {
  return render(
    <MapCanvas
      ambulancias={MOCK_AMBULANCIAS}
      emergencias={MOCK_EMERGENCIAS}
      self={{ position: { lat: 4.65, lng: -74.06 }, simulated: false, label: 'Tú' }}
      selfRings
      notifiedAmbulanceIds={['A-07', 'A-12', 'A-03']}
      dimmedAmbulanceIds={['A-09', 'A-15']}
      onSelectAmbulance={() => undefined}
      onSelectEmergency={() => undefined}
    />,
  );
}

describe('MapCanvas smoke', () => {
  beforeEach(resetLayers);
  afterEach(resetLayers);

  it('mounts with leaflet markers', () => {
    const { container } = renderMap();
    expect(container.querySelectorAll('.nv-marker').length).toBeGreaterThan(0);
    expect(container.querySelector('.leaflet-container')).not.toBeNull();
  });

  it('only draws emergency markers for the visible levels', () => {
    useLayersStore.setState({ visibleLevels: ['CRITICAL'] });

    const labels = markerLabels(renderMap().container);

    expect(labels).toContain('EMG-001');
    expect(labels).toContain('EMG-004');
    expect(labels).not.toContain('EMG-002');
    expect(labels).not.toContain('EMG-003');
    expect(labels).not.toContain('EMG-005');
  });

  it('hides ambulances when the overlay is toggled off', () => {
    useLayersStore.setState({ overlays: { ...DEFAULT_OVERLAYS, ambulancias: false } });

    const labels = markerLabels(renderMap().container);

    expect(labels).not.toContain('A-07');
    expect(labels).toContain('EMG-001');
  });

  it('draws an inline glyph for units, emergencies and aid centers', () => {
    const { container } = renderMapWithCenters(() => undefined);

    for (const label of ['A-07', 'EMG-001', 'Suba Norte']) {
      expect(markerByLabel(container, label).querySelector('.nv-marker__glyph')).not.toBeNull();
    }
    // The anonymous dot is gone: every marker now has a shaped glyph.
    expect(container.querySelector('.nv-marker__dot')).toBeNull();
  });

  it('draws a level badge on aid-center markers', () => {
    const { container } = renderMapWithCenters(() => undefined);

    const badge = markerByLabel(container, 'Suba Norte').querySelector('.nv-marker__badge');
    expect(badge).not.toBeNull();
    expect(badge?.querySelector('.nv-marker__glyph')).not.toBeNull();
  });

  it('EP-03.F1.US5: an alerted center draws a shortage badge with the missing quantity', () => {
    const { container } = render(
      <MapCanvas
        ambulancias={[]}
        emergencias={[]}
        centros={[
          {
            id: 'CA-ALERTA',
            nombre: 'Acopio Alerta',
            ubicacion: { lat: 4.7, lng: -74.08 },
            items: [],
            alerta: {
              itemId: 'INV-1',
              nombre: 'Agua potable',
              cantidadSolicitada: 8,
              faltante: 3,
              creadaEn: '2026-09-27T10:00:00Z',
            },
          },
        ]}
        onSelectAmbulance={() => undefined}
        onSelectEmergency={() => undefined}
      />,
    );

    const marker = markerByLabel(container, 'Alerta');
    const shortage = marker.querySelector('.nv-marker__shortage');
    expect(shortage).not.toBeNull();
    expect(shortage?.textContent).toBe('3');

    // Clearly distinguishable from the traffic-light badge: it is its own node
    // and class (the level glyph stays on the badge), so they mean different
    // things: an unmet demand vs the stock level.
    expect(marker.querySelector('.nv-marker__badge')).not.toBeNull();
    expect(shortage?.classList.contains('nv-marker__badge')).toBe(false);
    expect(GLOBALS_CSS).toContain('.nv-marker__shortage');
  });

  it('EP-03.F1.US5: a center without an alert draws no shortage badge', () => {
    const { container } = renderMapWithCenters(() => undefined);

    // Degradation: the demo centers carry no alert, so every one of them keeps
    // exactly today's marker (level badge only, no second badge).
    for (const label of ['Suba Norte', 'La Gaitana', 'Tibabuyes']) {
      const marker = markerByLabel(container, label);
      expect(marker.querySelector('.nv-marker__shortage')).toBeNull();
      expect(marker.querySelector('.nv-marker__badge')).not.toBeNull();
    }
  });

  it('AC1: draws a hospital with its own marker, distinct from a supply center', () => {
    const { container } = renderMapWithCenters(() => undefined);

    const hospital = markerByLabel(container, 'Hospital Suba');
    const center = markerByLabel(container, 'Suba Norte');

    // A different class AND a different shape, not a recoloured center.
    expect(hospital.classList.contains('nv-marker--hospital')).toBe(true);
    expect(hospital.classList.contains('nv-marker--center')).toBe(false);
    expect(hospital.querySelector('.nv-hospital-shape')).not.toBeNull();
    // A hospital has no inventory, so it never wears a traffic-light badge.
    expect(hospital.querySelector('.nv-marker__badge')).toBeNull();

    expect(center.classList.contains('nv-marker--center')).toBe(true);
    expect(center.querySelector('.nv-marker__badge')).not.toBeNull();
  });

  it('AC4: a center without tipo renders exactly as today, as a supply center', () => {
    const { container } = render(
      <MapCanvas
        ambulancias={[]}
        emergencias={[]}
        centros={[
          {
            id: 'CA-NO-TIPO',
            nombre: 'Acopio Sin Tipo',
            ubicacion: { lat: 4.7, lng: -74.08 },
            items: [],
          },
        ]}
        onSelectAmbulance={() => undefined}
        onSelectEmergency={() => undefined}
      />,
    );

    const marker = markerByLabel(container, 'Sin Tipo');
    expect(marker.classList.contains('nv-marker--center')).toBe(true);
    expect(marker.classList.contains('nv-marker--hospital')).toBe(false);
    expect(marker.querySelector('.nv-marker__badge')).not.toBeNull();
  });

  it('draws free and busy unit variants without a heading rotation', () => {
    const { container } = renderMap();

    const free = markerByLabel(container, 'A-07'); // AVAILABLE
    const busy = markerByLabel(container, 'A-15'); // EN_ROUTE

    expect(free.classList.contains('nv-marker--available')).toBe(true);
    expect(free.querySelector('.nv-marker__badge')).not.toBeNull();
    expect(busy.classList.contains('nv-marker--en_route')).toBe(true);
    expect(busy.querySelector('.nv-marker__badge')).not.toBeNull();
    // The mockup never rotates units, so no shape carries a bearing transform.
    expect(container.querySelector('.nv-marker__shape[style*="rotate"]')).toBeNull();
  });

  it('renders the self marker as a static dot, without the pulsing ring', () => {
    const { container } = renderMapWithSelf();

    const self = container.querySelector('.nv-marker--self');
    expect(self).not.toBeNull();
    expect(self?.querySelector('.nv-marker__shape')).not.toBeNull();
    // The old animated ring node is gone: the ring is a static box-shadow now.
    expect(container.querySelector('.nv-marker__ring')).toBeNull();
  });

  it('draws the requester pin with two static rings, the connector and the notified ring', () => {
    const { container } = renderMapWithRequest();

    const request = container.querySelector('.nv-marker--request');
    expect(request).not.toBeNull();
    expect(request?.querySelectorAll('.nv-marker__request-ring')).toHaveLength(2);
    expect(request?.querySelector('.nv-marker__label')?.textContent).toBe('Suba · 1,2 km');

    // The connector is a dashed visual line, not a calculated route.
    expect(container.querySelectorAll('.nv-connector-line').length).toBeGreaterThan(0);
    expect(container.querySelector('.nv-connector-line--solid')).toBeNull();

    // Only the notified unit carries the static teal ring.
    expect(markerByLabel(container, 'A-15').classList.contains('nv-marker--notified')).toBe(true);
    expect(markerByLabel(container, 'A-07').classList.contains('nv-marker--notified')).toBe(false);
  });

  it('draws the live-mission connector solid and lets a unit carry its own label', () => {
    const { container } = render(
      <MapCanvas
        ambulancias={MOCK_AMBULANCIAS}
        emergencias={MOCK_EMERGENCIAS}
        request={{ position: { lat: 4.63, lng: -74.07 }, label: 'Suba · 1,2 km' }}
        requestConnector={{
          from: { lat: 4.65, lng: -74.06 },
          to: { lat: 4.63, lng: -74.07 },
          dashed: false,
        }}
        ambulanceLabels={{ 'A-07': 'A-07 · 5 min' }}
        onSelectAmbulance={() => undefined}
        onSelectEmergency={() => undefined}
      />,
    );

    // `C.d4`/`C.c4`: the mission connector is solid, not dashed.
    expect(container.querySelector('.nv-connector-line--solid')).not.toBeNull();
    expect(container.querySelector('.nv-connector-casing')).not.toBeNull();
    // The assigned unit's marker shows the computed ETA label, not its bare id.
    expect(markerByLabel(container, 'A-07 · 5 min')).not.toBeNull();
  });

  /** A real OSRM-shaped route, already in Leaflet `[lat, lng]` order. */
  const RUTA_FIXTURE: Ruta = {
    geometria: [
      [4.65, -74.06],
      [4.64, -74.065],
      [4.63, -74.07],
    ],
    distanciaKm: 4.512,
    duracionMin: 8.0667,
  };

  it('AC1: draws the real route layers and drops the straight connector', () => {
    const { container } = render(
      <MapCanvas
        ambulancias={MOCK_AMBULANCIAS}
        emergencias={MOCK_EMERGENCIAS}
        requestConnector={{
          from: { lat: 4.65, lng: -74.06 },
          to: { lat: 4.63, lng: -74.07 },
          dashed: false,
        }}
        ruta={RUTA_FIXTURE}
        onSelectAmbulance={() => undefined}
        onSelectEmergency={() => undefined}
      />,
    );

    // The real geometry is painted with its own classes...
    expect(container.querySelectorAll('.nv-route-line').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.nv-route-casing').length).toBeGreaterThan(0);
    // ...and the straight connector steps aside instead of double-drawing.
    expect(container.querySelector('.nv-connector-line')).toBeNull();
    expect(container.querySelector('.nv-connector-casing')).toBeNull();
  });

  it('AC3: draws only the straight connector when there is no route', () => {
    const { container } = render(
      <MapCanvas
        ambulancias={MOCK_AMBULANCIAS}
        emergencias={MOCK_EMERGENCIAS}
        requestConnector={{
          from: { lat: 4.65, lng: -74.06 },
          to: { lat: 4.63, lng: -74.07 },
          dashed: false,
        }}
        ruta={null}
        onSelectAmbulance={() => undefined}
        onSelectEmergency={() => undefined}
      />,
    );

    // No route: nothing with the route class is painted, and the connector is.
    expect(container.querySelector('.nv-route-line')).toBeNull();
    expect(container.querySelector('.nv-route-casing')).toBeNull();
    expect(container.querySelector('.nv-connector-line')).not.toBeNull();
    expect(container.querySelector('.nv-connector-casing')).not.toBeNull();
  });

  it('colours an aid center from the palette shared with the legend', () => {
    const { container } = renderMapWithCenters(() => undefined);

    // Suba Norte: 10% RED (agua potable), 90% GREEN, 50% AMBER -> worst is RED.
    const pin = markerByLabel(container, 'Suba Norte');
    // Anchored to the real mockup tokens and values, never to CENTER_LEVEL_STYLE
    // comparing against itself: a lime -> blue change must break this test.
    expect(pin.style.getPropertyValue('--nv-marker-bg')).toBe('var(--nv-red)');
    expect(pin.style.getPropertyValue('--nv-marker-color')).toBe('var(--nv-on-accent)');

    expect(CENTER_LEVEL_STYLE.stable.bg).toBe('var(--nv-lime)');
    expect(CENTER_LEVEL_STYLE.stable.fg).toBe('var(--nv-navy)');
    expect(CENTER_LEVEL_STYLE.alert.bg).toBe('var(--nv-amber)');
    expect(CENTER_LEVEL_STYLE.critical.bg).toBe('var(--nv-red)');
    // The code stores `var(--nv-*)`, so pin each token's value in :root too.
    expect(GLOBALS_CSS).toContain(paletteDeclaration('lime'));
    expect(GLOBALS_CSS).toContain(paletteDeclaration('amber'));
    expect(GLOBALS_CSS).toContain(paletteDeclaration('red'));
    expect(GLOBALS_CSS).toContain(paletteDeclaration('navy'));
  });

  it('reports the aid center when its own marker is clicked', () => {
    const onSelectCentro = vi.fn();
    const { container } = renderMapWithCenters(onSelectCentro);

    fireEvent.click(markerByLabel(container, 'Suba Norte'));

    expect(onSelectCentro).toHaveBeenCalledWith('CA-SUBA-NORTE');
  });

  it('U2b: paints every zone the layer carries, as a real area footprint', () => {
    const { container } = renderMapWithZones();

    // The "Zonas" layer is ON (the page hands the map its filtered zones), so
    // the zone paints as its contour polygon, never as a bare point.
    expect(container.querySelectorAll('path.nv-zone-area').length).toBe(1);
  });

  it('U2b: never derives a zone from the selected center', () => {
    // The layer carries a zone, so it paints — that is the layer's rule, not the
    // selection's. Proving the two are separate needs the opposite case too.
    const { container } = renderMapWithSelectedZone();
    expect(container.querySelectorAll('path.nv-zone-area').length).toBe(1);

    // A selected center with the "Zonas" layer empty paints NOTHING: selection
    // can never reveal a zone the filter did not let through.
    cleanup();
    const { container: empty } = render(
      <MapCanvas
        ambulancias={[]}
        emergencias={[]}
        centros={MOCK_CENTROS_AYUDA}
        selectedCentroId="CA-SUBA-NORTE"
        zonas={[]}
        onSelectAmbulance={() => undefined}
        onSelectEmergency={() => undefined}
      />,
    );
    expect(empty.querySelector('path.nv-zone-area')).toBeNull();
  });

  it('clears the selection on a background click, never on a marker click', () => {
    const onClearSelection = vi.fn();
    const onSelectCentro = vi.fn();
    const { container } = render(
      <MapCanvas
        ambulancias={[]}
        emergencias={[]}
        centros={MOCK_CENTROS_AYUDA}
        onSelectAmbulance={() => undefined}
        onSelectEmergency={() => undefined}
        onSelectCentro={onSelectCentro}
        onClearSelection={onClearSelection}
      />,
    );

    // A click on the map background (the Leaflet container itself, not a marker)
    // releases the selection.
    fireEvent.click(container.querySelector('.leaflet-container') as HTMLElement);
    expect(onClearSelection).toHaveBeenCalledTimes(1);
    expect(onSelectCentro).not.toHaveBeenCalled();

    // A marker click selects and must NOT read as a background click: Leaflet's
    // `Marker` does not bubble its click (`bubblingMouseEvents: false`).
    onClearSelection.mockClear();
    fireEvent.click(markerByLabel(container, 'Suba Norte'));
    expect(onSelectCentro).toHaveBeenCalledWith('CA-SUBA-NORTE');
    expect(onClearSelection).not.toHaveBeenCalled();
  });

  it('draws the citizen radar rings anchored on the self marker', () => {
    const { container } = renderMapWithSearch();

    const rings = container.querySelector('.nv-rings');
    expect(rings).not.toBeNull();
    expect(rings?.querySelectorAll('.nv-ring')).toHaveLength(3);
    expect(rings?.querySelector('.nv-ring--fill')).not.toBeNull();
    expect(rings?.querySelectorAll('.nv-ring--anim')).toHaveLength(2);
  });

  it('draws no radar rings when no search is active', () => {
    const { container } = renderMapWithSelf();

    expect(container.querySelector('.nv-rings')).toBeNull();
  });

  it('keeps the search radius on the ground across zoom levels, not in pixels', () => {
    const { container } = renderMapWithSearch();

    // The divIcon's pixel size IS the ring's ground diameter at the current zoom.
    const diameterPx = () => {
      const rings = container.querySelector('.nv-rings');
      if (!rings?.parentElement) {
        throw new Error('radar rings not rendered');
      }
      return Number.parseFloat(rings.parentElement.style.width);
    };

    const before = diameterPx();
    expect(before).toBeGreaterThan(0);
    // One zoom step doubles the pixels a metre spans, so the same terrain needs
    // twice the pixels: the icon grows with the zoom instead of staying fixed.
    fireEvent.click(container.querySelector('.leaflet-control-zoom-in') as HTMLElement);

    expect(diameterPx()).toBeCloseTo(2 * before, 3);
  });

  it('draws no radar rings when the search alerted no unit on the map', () => {
    const { container } = render(
      <MapCanvas
        ambulancias={MOCK_AMBULANCIAS}
        emergencias={MOCK_EMERGENCIAS}
        self={{ position: { lat: 4.65, lng: -74.06 }, simulated: false, label: 'Tú' }}
        selfRings
        notifiedAmbulanceIds={['A-99']}
        onSelectAmbulance={() => undefined}
        onSelectEmergency={() => undefined}
      />,
    );

    // There is no alerted unit to measure, so there is no honest radius to draw.
    expect(container.querySelector('.nv-rings')).toBeNull();
  });

  it('marks the alerted units with the notified ring and dims the rest', () => {
    const { container } = renderMapWithSearch();

    for (const id of ['A-07', 'A-12', 'A-03']) {
      const marker = markerByLabel(container, id);
      expect(marker.classList.contains('nv-marker--notified')).toBe(true);
      expect(marker.classList.contains('nv-marker--dim')).toBe(false);
    }
    for (const id of ['A-09', 'A-15']) {
      expect(markerByLabel(container, id).classList.contains('nv-marker--dim')).toBe(true);
    }
  });

  it('ships the radar/spinner CSS, animated only without a reduced-motion preference', () => {
    expect(GLOBALS_CSS).toContain('.nv-ring--fill');
    expect(GLOBALS_CSS).toContain('.nv-ring--d2');
    // The mockup's `.d3` ring (1.6s) is dead CSS the mockup never emits: no node
    // and no rule for a third animated ring must exist here either.
    expect(GLOBALS_CSS).not.toContain('nv-ring--d3');
    expect(GLOBALS_CSS).toContain('.nv-marker--dim');
    // The solid mission connector is a real rule, not only a class name.
    expect(GLOBALS_CSS).toContain('.nv-connector-line--solid');
    // The real route's own classes also exist as rules, not just DOM classes.
    expect(GLOBALS_CSS).toContain('.nv-route-casing');
    expect(GLOBALS_CSS).toContain('.nv-route-line');
    expect(GLOBALS_CSS).toContain('@keyframes nv-radar');
    expect(GLOBALS_CSS).toContain('@keyframes nv-spin');
    expect(GLOBALS_CSS).toContain('prefers-reduced-motion: no-preference');
  });
});
