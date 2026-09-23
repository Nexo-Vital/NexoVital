import { centroSemaforo } from '@/features/recursos/traffic-light';
import { distanceKm, etaMinutes } from '@/lib/geo';
import type {
  AmbulanceState,
  Ambulancia,
  CentroAyuda,
  InventarioItem,
  TrafficLight,
  Ubicacion,
} from '@/types/domain';

/**
 * Citizen-facing projection of the operations data.
 *
 * The CRUE screen speaks the full domain (four traffic-light levels, four unit
 * states). The citizen screen needs a coarse but honest summary, so this module
 * folds the domain onto the levels the mockup shows. It is pure: no store, no
 * fetch, no formatting of live data beyond what is passed in.
 */

/** Where the citizen marker sits when the device gives no position (Suba). */
export const CITIZEN_FALLBACK_POSITION: Ubicacion = { lat: 4.728, lng: -74.078 };

/**
 * Crisis levels the citizen summary tracks. `NOT_DECLARED` is deliberately NOT
 * folded into "stable": a center that declared no requirement is not healthy,
 * it is simply unknown, so it is counted in its own neutral bucket.
 */
export type CitizenCenterLevel = 'stable' | 'alert' | 'critical';

export const CITIZEN_LEVEL_ORDER: CitizenCenterLevel[] = ['stable', 'alert', 'critical'];

/**
 * Colour source shared by the map pins and the citizen legend.
 *
 * The pin HTML and the legend swatch both read these values, so a lime
 * "Estable" pin and a lime "Estable" swatch cannot drift apart. Values are
 * `var(--nv-*)` references to the fixed product palette (never hex), which is
 * exactly what the shared marker's CSS variables consume.
 */
export interface CenterLevelStyle {
  /** Square background: the pin fill and the legend swatch. */
  bg: string;
  /** Glyph colour on that background. */
  fg: string;
  /** Badge glyph colour, when it must differ from `fg` (critical). */
  badgeFg: string;
}

export const CENTER_LEVEL_STYLE: Record<CitizenCenterLevel, CenterLevelStyle> = {
  stable: { bg: 'var(--nv-lime)', fg: 'var(--nv-navy)', badgeFg: 'var(--nv-navy)' },
  alert: { bg: 'var(--nv-amber)', fg: 'var(--nv-navy)', badgeFg: 'var(--nv-navy)' },
  critical: { bg: 'var(--nv-red)', fg: 'var(--nv-on-accent)', badgeFg: 'var(--nv-red-600)' },
};

/** Neutral style for a centre that declared nothing; shared with its pin badge. */
export const NOT_DECLARED_CENTER_STYLE: CenterLevelStyle = {
  bg: 'var(--nv-idle)',
  fg: 'var(--nv-navy)',
  badgeFg: 'var(--nv-navy)',
};

export interface CitizenLevelMeta {
  label: string;
  /** Summary chip text, e.g. "2 críticos" (pluralized in Spanish). */
  summary: (count: number) => string;
}

/**
 * Label/summary only: the chip colours are read straight off `CENTER_LEVEL_STYLE`
 * at render time, so the summary chip and the legend swatch can never disagree
 * (a `bg-nv-red-600` chip once did, next to a `--nv-red` pin).
 */
export const CITIZEN_LEVEL_META: Record<CitizenCenterLevel, CitizenLevelMeta> = {
  stable: {
    label: 'Estable',
    summary: (count) => (count === 1 ? `${count} centro estable` : `${count} centros estables`),
  },
  alert: {
    label: 'En alerta',
    summary: (count) => `${count} en alerta`,
  },
  critical: {
    label: 'Crítico',
    summary: (count) => (count === 1 ? `${count} crítico` : `${count} críticos`),
  },
};

export interface CitizenCenterCounts {
  stable: number;
  alert: number;
  critical: number;
  /** Centers with nothing declared; neutral, never forced into "stable". */
  notDeclared: number;
}

/** Maps a domain traffic light onto the citizen level, or `null` when unknown. */
export function citizenCenterLevel(level: TrafficLight): CitizenCenterLevel | null {
  switch (level) {
    case 'GREEN':
      return 'stable';
    case 'AMBER':
      return 'alert';
    case 'RED':
      return 'critical';
    default:
      return null;
  }
}

/** Citizen level of a center, from its worst inventory item. */
export function centerLevel(centro: CentroAyuda): CitizenCenterLevel | null {
  return citizenCenterLevel(centroSemaforo(centro));
}

/** Counts centers by their worst inventory level (the map's own rule). */
export function countCentersByLevel(centros: CentroAyuda[]): CitizenCenterCounts {
  const counts: CitizenCenterCounts = { stable: 0, alert: 0, critical: 0, notDeclared: 0 };
  for (const centro of centros) {
    const level = centerLevel(centro);
    if (level === null) {
      counts.notDeclared += 1;
    } else {
      counts[level] += 1;
    }
  }
  return counts;
}

/**
 * Item a center is shortest on: the lowest available/required ratio among the
 * declared items. `null` when the center declared no requirement at all.
 */
export function mostUrgentItem(centro: CentroAyuda): InventarioItem | null {
  let urgent: InventarioItem | null = null;
  let lowestRatio = Number.POSITIVE_INFINITY;
  for (const item of centro.items) {
    if (item.requerido <= 0) {
      continue;
    }
    const ratio = item.disponible / item.requerido;
    if (ratio < lowestRatio) {
      lowestRatio = ratio;
      urgent = item;
    }
  }
  return urgent;
}

/**
 * Short label for a center's map marker.
 *
 * The mockup writes the full name on the rail ("Acopio Suba Norte") and the
 * short one on the pin ("Suba Norte"), so the short label is DERIVED by dropping
 * the "Acopio " prefix instead of stored a second time. A name without the
 * prefix is used as-is.
 */
export function centerShortName(centro: CentroAyuda): string {
  return centro.nombre.replace(/^Acopio\s+/, '');
}

/**
 * One-line "what this center needs" for the rail row, LITERAL from the mockup:
 * "Le falta agua potable" / "Le faltan alimentos" / "Inventario suficiente".
 *
 * Nothing is hardcoded per center: the level comes from the inventory and the
 * item is the scarcest declared one (`mostUrgentItem`), so a changed inventory
 * changes the text. The verb agrees with the item's grammatical number, which
 * the item itself declares (`grammaticalNumber`) — a bare name cannot give a
 * reliable signal ("gas" is singular and ends in "s", "casas" is plural and also
 * ends in "s"), so the agreement lives in the data, never in a text heuristic.
 */
export function centerNeedLabel(centro: CentroAyuda): string {
  const level = centerLevel(centro);
  if (level === 'stable') {
    return 'Inventario suficiente';
  }
  const urgent = mostUrgentItem(centro);
  if (!urgent) {
    return 'Sin requerimientos declarados';
  }
  const name = urgent.nombre.toLowerCase();
  return urgent.grammaticalNumber === 'plural' ? `Le faltan ${name}` : `Le falta ${name}`;
}

/**
 * Citizen-facing unit availability. The mockup only knows free/busy; the domain
 * also has MAINTENANCE, so it gets its own honest bucket instead of being
 * mislabelled as "ocupada".
 */
export type CitizenUnitStatus = 'free' | 'busy' | 'maintenance';

export const CITIZEN_UNIT_ORDER: CitizenUnitStatus[] = ['free', 'busy', 'maintenance'];

export interface CitizenUnitMeta {
  label: string;
  chipClass: string;
  /** Circular badge used in the legend and the rail rows. */
  markerClass: string;
}

export const CITIZEN_UNIT_META: Record<CitizenUnitStatus, CitizenUnitMeta> = {
  free: {
    label: 'Disponible',
    chipClass: 'bg-nv-lime text-nv-navy',
    markerClass: 'border-2 border-nv-teal bg-white text-nv-navy',
  },
  busy: {
    label: 'Ocupada',
    chipClass: 'bg-nv-navy text-white',
    markerClass: 'bg-nv-navy text-white',
  },
  maintenance: {
    label: 'En mantenimiento',
    chipClass: 'bg-nv-sky text-nv-navy',
    /*
      The marker maps MAINTENANCE onto the busy variant (the mockup draws only
      free/busy), so the legend swatch reuses that same navy circle instead of
      claiming a colour the map never draws.
    */
    markerClass: 'bg-nv-navy text-white',
  },
};

export function citizenUnitStatus(estado: AmbulanceState): CitizenUnitStatus {
  if (estado === 'AVAILABLE') {
    return 'free';
  }
  if (estado === 'MAINTENANCE') {
    return 'maintenance';
  }
  return 'busy';
}

export function countUnitsByStatus(units: Ambulancia[]): Record<CitizenUnitStatus, number> {
  const counts: Record<CitizenUnitStatus, number> = { free: 0, busy: 0, maintenance: 0 };
  for (const unit of units) {
    counts[citizenUnitStatus(unit.estado)] += 1;
  }
  return counts;
}

export interface NearbyAmbulance {
  ambulance: Ambulancia;
  status: CitizenUnitStatus;
  distanceKm: number;
  etaMin: number;
  /** Secondary line: the ETA when free, the reason it is not, otherwise. */
  detail: string;
}

/** Decimal comma, as the mockup writes it ("2,6 km"). */
export function formatDistance(km: number): string {
  return `${km.toFixed(1).replace('.', ',')} km`;
}

/**
 * Nearest units to the citizen, sorted by distance and capped at `limit`.
 * Rows carry either the relative ETA or the reason the unit cannot come.
 */
export function nearbyAmbulances(
  units: Ambulancia[],
  from: Ubicacion,
  limit = 3,
): NearbyAmbulance[] {
  return units
    .map((ambulance) => {
      const km = distanceKm(from, ambulance.ubicacion);
      const status = citizenUnitStatus(ambulance.estado);
      const etaMin = etaMinutes(from, ambulance.ubicacion);
      return {
        ambulance,
        status,
        distanceKm: km,
        etaMin,
        detail:
          status === 'free'
            ? `${formatDistance(km)} · ${etaMin} min`
            : status === 'maintenance'
              ? 'En mantenimiento'
              : 'Atendiendo un servicio',
      };
    })
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);
}
