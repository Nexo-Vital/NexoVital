import { fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_LEVELS, DEFAULT_OVERLAYS, useLayersStore } from '@/features/mapa/layers-store';
import { MapCanvas } from '@/features/mapa/MapCanvas';
import { MOCK_AMBULANCIAS, MOCK_CENTROS_AYUDA, MOCK_EMERGENCIAS } from '@/mocks/fixtures';

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

    expect(labels).not.toContain('AMB-01');
    expect(labels).toContain('EMG-001');
  });

  it('draws an inline glyph for units, emergencies and aid centers', () => {
    const { container } = renderMapWithCenters(() => undefined);

    for (const label of ['AMB-01', 'EMG-001', 'CA-NORTE']) {
      expect(markerByLabel(container, label).querySelector('.nv-marker__glyph')).not.toBeNull();
    }
    // The anonymous dot is gone: every marker now has a shaped glyph.
    expect(container.querySelector('.nv-marker__dot')).toBeNull();
  });

  it('colours an aid center by the worst item in its inventory', () => {
    const { container } = renderMapWithCenters(() => undefined);

    // CA-NORTE: 60% AMBER, 20% RED, 90% GREEN, NOT_DECLARED -> worst is RED.
    expect(markerByLabel(container, 'CA-NORTE').style.getPropertyValue('--nv-marker-color')).toBe(
      'var(--nv-critical)',
    );
  });

  it('reports the aid center when its own marker is clicked', () => {
    const onSelectCentro = vi.fn();
    const { container } = renderMapWithCenters(onSelectCentro);

    fireEvent.click(markerByLabel(container, 'CA-NORTE'));

    expect(onSelectCentro).toHaveBeenCalledWith('CA-NORTE');
  });
});
