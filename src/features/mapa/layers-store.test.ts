import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MOCK_EMERGENCIAS } from '@/mocks/fixtures';
import {
  ALL_LEVELS,
  baseLayerForTheme,
  DEFAULT_OVERLAYS,
  filterByLevel,
  resolveBaseLayer,
  useLayersStore,
} from './layers-store';

function resetLayers() {
  useLayersStore.setState({
    baseLayer: 'dark',
    baseLayerOverridden: false,
    overlays: { ...DEFAULT_OVERLAYS },
    visibleLevels: [...ALL_LEVELS],
  });
}

describe('layers store', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetLayers();
  });

  afterEach(() => {
    window.localStorage.clear();
    resetLayers();
  });

  it('maps each app theme to a matching basemap', () => {
    expect(baseLayerForTheme('dark')).toBe('dark');
    expect(baseLayerForTheme('light')).toBe('light');
  });

  it('follows the theme until the user explicitly picks a base layer', () => {
    // Default precedence: theme wins while the user has not overridden.
    expect(resolveBaseLayer('light', false, 'dark')).toBe('light');

    useLayersStore.getState().syncBaseLayerToTheme('light');
    expect(useLayersStore.getState().baseLayer).toBe('light');
    expect(useLayersStore.getState().baseLayerOverridden).toBe(false);

    // An explicit pick beats the theme from now on.
    useLayersStore.getState().setBaseLayer('satellite');
    expect(useLayersStore.getState().baseLayerOverridden).toBe(true);

    useLayersStore.getState().syncBaseLayerToTheme('dark');
    expect(useLayersStore.getState().baseLayer).toBe('satellite');
    expect(resolveBaseLayer('dark', true, 'satellite')).toBe('satellite');
  });

  it('toggles overlay visibility and emergency levels', () => {
    useLayersStore.getState().toggleOverlay('centros');
    expect(useLayersStore.getState().overlays.centros).toBe(false);
    useLayersStore.getState().toggleOverlay('centros');
    expect(useLayersStore.getState().overlays.centros).toBe(true);

    useLayersStore.getState().toggleLevel('LOW');
    expect(useLayersStore.getState().visibleLevels).toEqual(['MEDIUM', 'HIGH', 'CRITICAL']);
    useLayersStore.getState().toggleLevel('LOW');
    expect([...useLayersStore.getState().visibleLevels].sort()).toEqual([...ALL_LEVELS].sort());
  });

  it('filters emergencies by the visible level set', () => {
    expect(filterByLevel(MOCK_EMERGENCIAS, ['CRITICAL']).map((item) => item.id)).toEqual([
      'EMG-001',
      'EMG-004',
    ]);
    expect(filterByLevel(MOCK_EMERGENCIAS, ['LOW', 'MEDIUM']).map((item) => item.id)).toEqual([
      'EMG-003',
      'EMG-005',
    ]);
    expect(filterByLevel(MOCK_EMERGENCIAS, [])).toEqual([]);
  });
});
