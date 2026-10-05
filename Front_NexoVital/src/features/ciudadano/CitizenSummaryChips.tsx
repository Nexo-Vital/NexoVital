import { CircleCheck, Info, OctagonAlert, TriangleAlert } from 'lucide-react';
import {
  CENTER_LEVEL_STYLE,
  CITIZEN_LEVEL_META,
  CITIZEN_LEVEL_ORDER,
  type CitizenCenterCounts,
  type CitizenCenterLevel,
} from './citizen-view';

const LEVEL_ICON: Record<CitizenCenterLevel, typeof CircleCheck> = {
  complete: CircleCheck,
  stable: CircleCheck,
  alert: TriangleAlert,
  critical: OctagonAlert,
};

/**
 * Live center counts by traffic light, mirroring the mockup's `summaryChips`.
 * The three crisis chips are always shown; a neutral "sin declarar" chip only
 * appears when a center really has no declared requirement, so the total always
 * accounts for every center on the map.
 */
export function CitizenSummaryChips({ counts }: { counts: CitizenCenterCounts }) {
  return (
    <ul
      aria-label="Resumen de centros por semáforo"
      className="flex list-none flex-wrap items-center gap-2 p-0"
    >
      {CITIZEN_LEVEL_ORDER.map((level) => {
        const meta = CITIZEN_LEVEL_META[level];
        // Same table the map pin and the legend swatch read, so no second red.
        const style = CENTER_LEVEL_STYLE[level];
        const Icon = LEVEL_ICON[level];
        return (
          <li
            key={level}
            className="inline-flex items-center gap-1.5 rounded-nv-pill px-3 py-1.5 font-semibold text-xs"
            style={{ background: style.bg, color: style.fg }}
          >
            <Icon className="size-3.5 shrink-0" aria-hidden />
            {meta.summary(counts[level])}
          </li>
        );
      })}
      {counts.notDeclared > 0 && (
        <li className="inline-flex items-center gap-1.5 rounded-nv-pill bg-nv-sky px-3 py-1.5 font-semibold text-nv-navy text-xs">
          <Info className="size-3.5 shrink-0" aria-hidden />
          {counts.notDeclared} sin declarar
        </li>
      )}
    </ul>
  );
}
