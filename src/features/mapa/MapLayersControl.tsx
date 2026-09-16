import { Ambulance, Building2, Layers, Siren } from 'lucide-react';
import { EMERGENCY_LEVEL_META } from '@/features/solicitudes/request-status';
import { cn } from '@/lib/utils';
import type { EmergencyLevel } from '@/types/domain';
import { ALL_LEVELS, type OverlayKey, useLayersStore } from './layers-store';
import { BASE_LAYERS, type BaseLayer } from './mapConfig';

const BASE_LAYER_ORDER: BaseLayer[] = ['dark', 'light', 'satellite'];

const OVERLAY_META: { key: OverlayKey; label: string; Icon: typeof Ambulance }[] = [
  { key: 'ambulancias', label: 'Ambulances', Icon: Ambulance },
  { key: 'emergencias', label: 'Emergencies', Icon: Siren },
  { key: 'centros', label: 'Aid centers', Icon: Building2 },
];

/** Contract levels map BAJO/MEDIO/ALTO/CRITICO -> ok/warning/assign/critical. */
const LEVEL_ORDER: EmergencyLevel[] = ALL_LEVELS;

/**
 * Styled basemap/overlay/level control. It is an app overlay (not the default
 * Leaflet control) so it can use the design tokens in both themes.
 *
 * By default it floats over the map (desktop). On mobile it is rendered inline
 * inside the layers sheet, so callers can pass `className` to drop the floating
 * positioning and let it fill its container.
 */
export function MapLayersControl({ className }: { className?: string }) {
  const baseLayer = useLayersStore((state) => state.baseLayer);
  const overlays = useLayersStore((state) => state.overlays);
  const visibleLevels = useLayersStore((state) => state.visibleLevels);
  const setBaseLayer = useLayersStore((state) => state.setBaseLayer);
  const toggleOverlay = useLayersStore((state) => state.toggleOverlay);
  const toggleLevel = useLayersStore((state) => state.toggleLevel);

  return (
    <fieldset
      className={cn(
        'absolute top-3 right-3 z-[650] w-56 rounded-md border border-border bg-card/95 p-2 text-xs shadow-sm backdrop-blur',
        className,
      )}
    >
      <legend className="sr-only">Map layers</legend>
      <p className="mb-1.5 flex items-center gap-1.5 font-semibold text-[10px] text-muted-foreground uppercase tracking-wide">
        <Layers className="size-3" aria-hidden />
        Base map
      </p>
      <div className="grid grid-cols-3 gap-1">
        {BASE_LAYER_ORDER.map((layer) => {
          const active = baseLayer === layer;
          return (
            <button
              key={layer}
              type="button"
              aria-pressed={active}
              onClick={() => setBaseLayer(layer)}
              className={cn(
                'rounded border px-1.5 py-1 font-medium text-[11px] transition-colors',
                active
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              {BASE_LAYERS[layer].label}
            </button>
          );
        })}
      </div>

      <p className="mt-2 mb-1.5 font-semibold text-[10px] text-muted-foreground uppercase tracking-wide">
        Overlays
      </p>
      <div className="flex flex-col gap-1">
        {OVERLAY_META.map(({ key, label, Icon }) => {
          const active = overlays[key];
          return (
            <button
              key={key}
              type="button"
              aria-pressed={active}
              onClick={() => toggleOverlay(key)}
              className={cn(
                'flex items-center gap-2 rounded border px-1.5 py-1 text-left transition-colors',
                active
                  ? 'border-border bg-surface-2 text-foreground'
                  : 'border-border/60 text-muted-foreground opacity-60 hover:opacity-100',
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              <span className="flex-1 font-medium">{label}</span>
              <span
                className={cn(
                  'size-2 rounded-full border',
                  active ? 'border-primary bg-primary' : 'border-border bg-transparent',
                )}
                aria-hidden
              />
            </button>
          );
        })}
      </div>

      <p className="mt-2 mb-1.5 font-semibold text-[10px] text-muted-foreground uppercase tracking-wide">
        Emergency level
      </p>
      <div className="flex flex-wrap gap-1">
        {LEVEL_ORDER.map((level) => {
          const meta = EMERGENCY_LEVEL_META[level];
          const active = visibleLevels.includes(level);
          return (
            <button
              key={level}
              type="button"
              aria-pressed={active}
              title={`Show ${meta.label.toLowerCase()} emergencies`}
              onClick={() => toggleLevel(level)}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold text-[10px] uppercase tracking-wide transition-colors',
                active
                  ? cn(meta.borderClass, meta.textClass)
                  : 'border-border text-muted-foreground opacity-60',
              )}
            >
              <span
                className={cn('size-1.5 rounded-full', active ? meta.dotClass : 'bg-idle')}
                aria-hidden
              />
              {meta.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
