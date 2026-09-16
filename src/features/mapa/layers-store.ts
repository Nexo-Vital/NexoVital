import { create } from 'zustand';
import type { ResolvedTheme } from '@/features/tema/theme-store';
import { useThemeStore } from '@/features/tema/theme-store';
import type { EmergencyLevel } from '@/types/domain';
import type { BaseLayer } from './mapConfig';

export const LAYERS_STORAGE_KEY = 'nexovital.layers';

export const ALL_LEVELS: EmergencyLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export type OverlayKey = 'ambulancias' | 'emergencias' | 'centros';

export type OverlayVisibility = Record<OverlayKey, boolean>;

export const DEFAULT_OVERLAYS: OverlayVisibility = {
  ambulancias: true,
  emergencias: true,
  centros: true,
};

/** The basemap that matches an app theme: dark theme -> dark basemap, etc. */
export function baseLayerForTheme(theme: ResolvedTheme): BaseLayer {
  return theme === 'dark' ? 'dark' : 'light';
}

/**
 * Base layer precedence: an explicit user pick always wins; otherwise the
 * basemap follows the app theme.
 */
export function resolveBaseLayer(
  theme: ResolvedTheme,
  overridden: boolean,
  current: BaseLayer,
): BaseLayer {
  return overridden ? current : baseLayerForTheme(theme);
}

export function isBaseLayer(value: unknown): value is BaseLayer {
  return value === 'dark' || value === 'light' || value === 'satellite';
}

export function isEmergencyLevel(value: unknown): value is EmergencyLevel {
  return typeof value === 'string' && ALL_LEVELS.includes(value as EmergencyLevel);
}

/** Keep only the items whose emergency level is currently visible. */
export function filterByLevel<T extends { nivel: EmergencyLevel }>(
  items: T[],
  visibleLevels: EmergencyLevel[],
): T[] {
  return items.filter((item) => visibleLevels.includes(item.nivel));
}

interface PersistedLayers {
  baseLayer?: BaseLayer;
  baseLayerOverridden?: boolean;
  overlays?: Partial<OverlayVisibility>;
  visibleLevels?: EmergencyLevel[];
}

function readPersistedLayers(): PersistedLayers {
  if (typeof window === 'undefined') {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(LAYERS_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return {};
    }
    const candidate = parsed as PersistedLayers;
    return {
      baseLayer: isBaseLayer(candidate.baseLayer) ? candidate.baseLayer : undefined,
      baseLayerOverridden:
        typeof candidate.baseLayerOverridden === 'boolean'
          ? candidate.baseLayerOverridden
          : undefined,
      overlays:
        candidate.overlays && typeof candidate.overlays === 'object'
          ? candidate.overlays
          : undefined,
      visibleLevels: Array.isArray(candidate.visibleLevels)
        ? candidate.visibleLevels.filter(isEmergencyLevel)
        : undefined,
    };
  } catch {
    return {};
  }
}

function writePersistedLayers(state: LayersState): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    const payload: PersistedLayers = {
      baseLayer: state.baseLayer,
      baseLayerOverridden: state.baseLayerOverridden,
      overlays: state.overlays,
      visibleLevels: state.visibleLevels,
    };
    window.localStorage.setItem(LAYERS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage can be unavailable (private mode); in-memory state still works.
  }
}

export interface LayersState {
  baseLayer: BaseLayer;
  /** True once the user explicitly picks a base layer (beats the theme). */
  baseLayerOverridden: boolean;
  overlays: OverlayVisibility;
  visibleLevels: EmergencyLevel[];
  setBaseLayer: (layer: BaseLayer) => void;
  toggleOverlay: (key: OverlayKey) => void;
  toggleLevel: (level: EmergencyLevel) => void;
  /** Follow the app theme unless the user overrode the base layer. */
  syncBaseLayerToTheme: (theme: ResolvedTheme) => void;
  resetLayers: () => void;
}

const persisted = readPersistedLayers();
const initialBaseLayer = resolveBaseLayer(
  useThemeStore.getState().resolvedTheme,
  persisted.baseLayerOverridden ?? false,
  persisted.baseLayer ?? 'dark',
);

export const useLayersStore = create<LayersState>((set, get) => ({
  baseLayer: initialBaseLayer,
  baseLayerOverridden: persisted.baseLayerOverridden ?? false,
  overlays: { ...DEFAULT_OVERLAYS, ...persisted.overlays },
  visibleLevels: persisted.visibleLevels ?? [...ALL_LEVELS],
  setBaseLayer: (layer) => {
    set({ baseLayer: layer, baseLayerOverridden: true });
    writePersistedLayers(get());
  },
  toggleOverlay: (key) => {
    set({ overlays: { ...get().overlays, [key]: !get().overlays[key] } });
    writePersistedLayers(get());
  },
  toggleLevel: (level) => {
    const current = get().visibleLevels;
    const next = current.includes(level)
      ? current.filter((item) => item !== level)
      : [...current, level];
    set({ visibleLevels: next });
    writePersistedLayers(get());
  },
  syncBaseLayerToTheme: (theme) => {
    const next = resolveBaseLayer(theme, get().baseLayerOverridden, get().baseLayer);
    if (next === get().baseLayer) {
      return;
    }
    set({ baseLayer: next });
    writePersistedLayers(get());
  },
  resetLayers: () => {
    set({
      baseLayer: baseLayerForTheme(useThemeStore.getState().resolvedTheme),
      baseLayerOverridden: false,
      overlays: { ...DEFAULT_OVERLAYS },
      visibleLevels: [...ALL_LEVELS],
    });
    writePersistedLayers(get());
  },
}));
