import type { CSSProperties } from 'react';
import {
  CENTER_LEVEL_STYLE,
  CITIZEN_LEVEL_ORDER,
  CITIZEN_UNIT_META,
  type CitizenCenterLevel,
} from '@/features/ciudadano/citizen-view';
import { EMERGENCY_LEVEL_META } from '@/features/solicitudes/request-status';
import { cn } from '@/lib/utils';
import type { EmergencyLevel } from '@/types/domain';
import { useLayersStore } from './layers-store';

const EMERGENCY_LEVELS: EmergencyLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

/**
 * The mockup draws only two unit states on the map: free (white/teal) and busy
 * (navy). Every domain state other than AVAILABLE reuses the busy variant, so
 * the legend lists exactly those two.
 */
const AMBULANCE_STATES: Array<'free' | 'busy'> = ['free', 'busy'];

/**
 * This screen's own words. The CRUE room is in English while the citizen screen
 * is in Spanish, so the labels cannot be shared — but the colours must be, and
 * they still come from `citizen-view.ts`. Only the words live here.
 */
const CENTER_LEVEL_LABEL: Record<CitizenCenterLevel, string> = {
  stable: 'Stable',
  alert: 'Alert',
  critical: 'Critical',
};

/** The two unit states the map draws; every other domain state reuses `busy`. */
const UNIT_LABEL: Record<'free' | 'busy', string> = {
  free: 'Available',
  busy: 'Unavailable',
};

function LegendRow({
  swatchClass,
  swatchStyle,
  label,
  shape = 'dot',
  dimmed = false,
}: {
  swatchClass?: string;
  swatchStyle?: CSSProperties;
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
          swatchClass,
        )}
        style={swatchStyle}
        aria-hidden
      />
      <span className="text-muted-foreground">{label}</span>
    </li>
  );
}

/**
 * Read-only legend explaining marker colors. It reads the SAME shared sources as
 * the pins — `CENTER_LEVEL_STYLE` and `CITIZEN_UNIT_META` in `citizen-view.ts` —
 * so a swatch can never contradict the marker it describes. Emergency levels
 * keep their semantic tokens, matching the emergency pins, and levels hidden by
 * the map filter are dimmed so the legend always matches what is drawn.
 */
export function MapLegend() {
  const visibleLevels = useLayersStore((state) => state.visibleLevels);

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-[650] rounded-md border border-border bg-card/90 px-3 py-2 text-[11px] backdrop-blur">
      <p className="mb-1 font-semibold text-[10px] text-muted-foreground uppercase tracking-wide">
        Aid centers
      </p>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        {CITIZEN_LEVEL_ORDER.map((level) => {
          const style = CENTER_LEVEL_STYLE[level];
          return (
            <LegendRow
              key={level}
              label={CENTER_LEVEL_LABEL[level]}
              shape="square"
              swatchStyle={{ background: style.bg, color: style.fg }}
            />
          );
        })}
      </ul>

      <p className="mt-2 mb-1 font-semibold text-[10px] text-muted-foreground uppercase tracking-wide">
        Ambulances
      </p>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        {AMBULANCE_STATES.map((state) => (
          <LegendRow
            key={state}
            swatchClass={CITIZEN_UNIT_META[state].markerClass}
            label={UNIT_LABEL[state]}
          />
        ))}
      </ul>

      <p className="mt-2 mb-1 font-semibold text-[10px] text-muted-foreground uppercase tracking-wide">
        Emergency level
      </p>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        {EMERGENCY_LEVELS.map((level) => (
          <LegendRow
            key={level}
            swatchClass={EMERGENCY_LEVEL_META[level].dotClass}
            label={EMERGENCY_LEVEL_META[level].label}
            dimmed={!visibleLevels.includes(level)}
          />
        ))}
      </ul>
    </div>
  );
}
