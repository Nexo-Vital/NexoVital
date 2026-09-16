import { AMBULANCE_STATE_META } from '@/features/flota/ambulance-status';
import { EMERGENCY_LEVEL_META } from '@/features/solicitudes/request-status';
import { cn } from '@/lib/utils';
import type { AmbulanceState, EmergencyLevel } from '@/types/domain';
import { useLayersStore } from './layers-store';

const AMBULANCE_STATES: AmbulanceState[] = ['AVAILABLE', 'ASSIGNED', 'EN_ROUTE', 'MAINTENANCE'];
const EMERGENCY_LEVELS: EmergencyLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

function LegendRow({
  dotClass,
  label,
  shape = 'dot',
  dimmed = false,
}: {
  dotClass: string;
  label: string;
  shape?: 'dot' | 'square';
  dimmed?: boolean;
}) {
  return (
    <li className={cn('flex items-center gap-2', dimmed && 'opacity-40')}>
      <span
        className={cn(
          'size-2.5 shrink-0',
          shape === 'square' ? 'rounded-[3px]' : 'rounded-full',
          dotClass,
        )}
        aria-hidden
      />
      <span className="text-muted-foreground">{label}</span>
    </li>
  );
}

/**
 * Read-only legend explaining marker colors. It uses token classes only, so it
 * re-skins with the active theme, and dims emergency levels hidden by the map
 * filter so the legend always matches what is drawn.
 */
export function MapLegend() {
  const visibleLevels = useLayersStore((state) => state.visibleLevels);

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-[650] rounded-md border border-border bg-card/90 px-3 py-2 text-[11px] backdrop-blur">
      <p className="mb-1 font-semibold text-[10px] text-muted-foreground uppercase tracking-wide">
        Units
      </p>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        {AMBULANCE_STATES.map((state) => (
          <LegendRow
            key={state}
            dotClass={AMBULANCE_STATE_META[state].dotClass}
            label={AMBULANCE_STATE_META[state].label}
          />
        ))}
        <LegendRow dotClass="bg-event" label="Aid center" shape="square" />
      </ul>
      <p className="mt-2 mb-1 font-semibold text-[10px] text-muted-foreground uppercase tracking-wide">
        Emergency level
      </p>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        {EMERGENCY_LEVELS.map((level) => (
          <LegendRow
            key={level}
            dotClass={EMERGENCY_LEVEL_META[level].dotClass}
            label={EMERGENCY_LEVEL_META[level].label}
            dimmed={!visibleLevels.includes(level)}
          />
        ))}
      </ul>
    </div>
  );
}
