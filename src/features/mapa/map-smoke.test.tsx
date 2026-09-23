import { fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CENTER_LEVEL_STYLE } from '@/features/ciudadano/citizen-view';
import { ALL_LEVELS, DEFAULT_OVERLAYS, useLayersStore } from '@/features/mapa/layers-store';
import { MapCanvas } from '@/features/mapa/MapCanvas';
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
    expect(GLOBALS_CSS).toContain('@keyframes nv-radar');
    expect(GLOBALS_CSS).toContain('@keyframes nv-spin');
    expect(GLOBALS_CSS).toContain('prefers-reduced-motion: no-preference');
  });
});
