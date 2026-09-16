import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ALL_LEVELS, DEFAULT_OVERLAYS, useLayersStore } from '@/features/mapa/layers-store';
import { MapCanvas } from '@/features/mapa/MapCanvas';
import { MOCK_AMBULANCIAS, MOCK_EMERGENCIAS } from '@/mocks/fixtures';

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
});
