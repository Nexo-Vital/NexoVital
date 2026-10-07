import { centroSemaforo, trafficLight } from '@/features/recursos/traffic-light';
import { distanceKm, etaMinutes } from '@/lib/geo';
import type {
  AlertaEscasez,
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
export type CitizenCenterLevel = 'complete' | 'stable' | 'alert' | 'critical';

export const CITIZEN_LEVEL_ORDER: CitizenCenterLevel[] = [
  'complete',
  'stable',
  'alert',
  'critical',
];

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
  complete: { bg: 'var(--nv-complete)', fg: 'var(--nv-navy)', badgeFg: 'var(--nv-navy)' },
  stable: { bg: 'var(--nv-lime)', fg: 'var(--nv-navy)', badgeFg: 'var(--nv-navy)' },
  alert: { bg: 'var(--nv-amber)', fg: 'var(--nv-navy)', badgeFg: 'var(--nv-navy)' },
  critical: { bg: 'var(--nv-red)', fg: 'var(--nv-on-accent)', badgeFg: 'var(--nv-red-600)' },
};

/**
 * Citizen level back to the traffic-light literal the marker badge reads, so the
 * pin's glyph is decided by the SAME combined level as its colour and the rail
 * chip. `null` (nothing declared) maps to the neutral `NOT_DECLARED` glyph.
 */
export const CITIZEN_LEVEL_TRAFFIC: Record<CitizenCenterLevel, TrafficLight> = {
  complete: 'COMPLETE',
  stable: 'GREEN',
  alert: 'AMBER',
  critical: 'RED',
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
  complete: {
    label: 'Completo',
    summary: (count) => (count === 1 ? `${count} centro completo` : `${count} centros completos`),
  },
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
  complete: number;
  stable: number;
  alert: number;
  critical: number;
  /** Centers with nothing declared; neutral, never forced into "stable". */
  notDeclared: number;
  /**
   * Hospitals (`tipo: 'HOSPITAL'`), counted on their own. A hospital has no
   * inventory, so it has no traffic-light level and must NOT inflate
   * `notDeclared` (FH-3): the legend gives it a plain count. Front-only demo
   * value — see `TipoCentroAyuda` in `src/types/domain.ts`.
   */
  hospitals: number;
}

/** Maps a domain traffic light onto the citizen level, or `null` when unknown. */
export function citizenCenterLevel(level: TrafficLight): CitizenCenterLevel | null {
  switch (level) {
    case 'COMPLETE':
      return 'complete';
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

/** Worst first: the most missing resource leads, ties broken by name. */
function byMostMissing(a: AlertaEscasez, b: AlertaEscasez): number {
  return b.faltante - a.faltante || a.nombre.localeCompare(b.nombre);
}

/**
 * Active shortage alerts of a center, most missing first (EP-03.F1.US5 /
 * EP-03.F3.US4): one per resource whose stock is below what the center declared
 * it needs.
 *
 * ONE source at a time, so the list can never contradict the inventory bars:
 *   - when the center's inventory is known (it has items, or it was read and is
 *     empty) the alerts are DERIVED from it, the same rule the backend applies
 *     (`requerido - disponible > 0`). The inventory is the live state: it moves
 *     with every `/topic/suministros` frame;
 *   - otherwise the alerts the map read-model sent (`alertas`, or the single
 *     worst `alerta` of an older payload) are used as they came.
 */
export function centerAlerts(centro: CentroAyuda): AlertaEscasez[] {
  if (centro.items.length > 0 || centro.inventarioCargado) {
    return centro.items
      .filter((item) => item.requerido > item.disponible)
      .map((item) => ({
        itemId: item.id,
        nombre: item.nombre,
        requerido: item.requerido,
        disponible: item.disponible,
        faltante: item.requerido - item.disponible,
      }))
      .sort(byMostMissing);
  }
  if (centro.alertas) {
    return [...centro.alertas].sort(byMostMissing);
  }
  return centro.alerta ? [centro.alerta] : [];
}

/** Whether the center is currently missing at least one resource. */
export function hasActiveAlert(centro: CentroAyuda): boolean {
  return centerAlerts(centro).length > 0;
}

const LIGHT_SEVERITY: Record<TrafficLight, number> = {
  NOT_DECLARED: 0,
  COMPLETE: 1,
  GREEN: 2,
  AMBER: 3,
  RED: 4,
};

/**
 * Worst traffic light of a center. It is the inventory's (`centroSemaforo`);
 * only when no inventory is known yet does it fall back to the alerts the map
 * sent, which carry the same two numbers the light is computed from.
 */
function worstLight(centro: CentroAyuda): TrafficLight {
  if (centro.items.length > 0 || centro.inventarioCargado) {
    return centroSemaforo(centro);
  }
  let worst: TrafficLight = 'NOT_DECLARED';
  for (const alerta of centerAlerts(centro)) {
    const light = trafficLight(alerta.disponible, alerta.requerido);
    if (LIGHT_SEVERITY[light] > LIGHT_SEVERITY[worst]) {
      worst = light;
    }
  }
  return worst;
}

/**
 * Citizen level of a center: its worst traffic light, nothing else.
 *
 *   - CRITICAL when the worst light is RED;
 *   - ALERT when it is AMBER;
 *   - STABLE when it is GREEN;
 *   - COMPLETE when every declared item is covered (or it declares nothing);
 *   - null (not declared) when nothing is known about the center.
 *
 * A shortage alert does NOT raise the level: an alert only says a resource is
 * below its maximum, which is true of a GREEN center at 90% too. The level is
 * how far below. The same value feeds the rail chip and the map pin, so both
 * can never disagree.
 */
export function centerLevel(centro: CentroAyuda): CitizenCenterLevel | null {
  return citizenCenterLevel(worstLight(centro));
}

/**
 * Counts centers by their worst inventory level (the map's own rule).
 *
 * Hospitals are counted apart (`hospitals`) and skipped for the traffic-light
 * buckets: an empty inventory would otherwise land in `notDeclared`, claiming a
 * hospital is an undeclared supply center (FH-3). A center with no `tipo` is
 * still counted as today.
 */
export function countCentersByLevel(centros: CentroAyuda[]): CitizenCenterCounts {
  const counts: CitizenCenterCounts = {
    complete: 0,
    stable: 0,
    alert: 0,
    critical: 0,
    notDeclared: 0,
    hospitals: 0,
  };
  for (const centro of centros) {
    if (centro.tipo === 'HOSPITAL') {
      counts.hospitals += 1;
      continue;
    }
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
 * declared items that still have a gap. `null` when the center declared no
 * requirement at all or every item is fully covered.
 */
export function mostUrgentItem(centro: CentroAyuda): InventarioItem | null {
  let urgent: InventarioItem | null = null;
  let lowestRatio = Number.POSITIVE_INFINITY;
  for (const item of centro.items) {
    if (item.requerido <= 0 || item.disponible >= item.requerido) {
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
 * One-line "what this center needs" for the rail row.
 *
 * The item is the scarcest declared one (`mostUrgentItem`), so nothing is
 * hardcoded per center: a changed inventory changes the text.
 *
 * The phrase is number-agnostic on purpose. The backend inventory does NOT
 * declare an item's grammatical number (see `InventarioItem.grammaticalNumber`),
 * so a verb template such as "Le falta X" renders the wrong agreement for a
 * plural or mass noun ("Le falta alimentos"). "Faltante: X" is a label that is
 * grammatically correct for both countable and mass nouns, so no agreement is
 * guessed. When nothing is declared but an active alert names the missing
 * resource, that name is used instead of claiming nothing was declared.
 */
export function centerNeedLabel(centro: CentroAyuda): string {
  const level = centerLevel(centro);
  if (level === 'complete') {
    return 'Inventario completo';
  }
  if (level === 'stable') {
    return 'Inventario suficiente';
  }
  const urgent = mostUrgentItem(centro);
  if (!urgent) {
    const [worst] = centerAlerts(centro);
    return worst ? `Faltante: ${worst.nombre.toLowerCase()}` : 'Sin requerimientos declarados';
  }
  return `Faltante: ${urgent.nombre.toLowerCase()}`;
}

/**
 * Citizen-facing unit availability. The mockup only knows free/busy; the domain
 * also has units that are out of service, so they get their own honest bucket
 * instead of being mislabelled as "ocupada". Two things put a unit there: the
 * MAINTENANCE state, and a driver who is disconnected from the service
 * (EP-04.F2.US1). Neither can take a request, and to the citizen they mean the
 * same thing: that ambulance is not working right now.
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
    label: 'Fuera de servicio',
    chipClass: 'bg-nv-sky text-nv-navy',
    /*
      The marker draws an out-of-service unit on the busy circle (the mockup
      draws only free/busy), so the legend swatch reuses that same navy circle
      instead of claiming a colour the map never draws. What tells it apart from
      a busy unit is the badge icon, on the map and in the legend alike.
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

/**
 * `false` while the unit's driver is disconnected from the service
 * (EP-04.F2.US1). An absent `conectada` means "connected": fixtures, the dev
 * relay and a backend that predates the field do not carry it.
 */
export function unitIsConnected(unit: Pick<Ambulancia, 'conectada'>): boolean {
  return unit.conectada !== false;
}

/**
 * Bucket of a whole UNIT, which is what the citizen sees. It is the state
 * bucket, except that a disconnected driver takes the unit out of service
 * whatever its state says: an available unit nobody is driving is not
 * available to the citizen.
 */
export function citizenUnitBucket(
  unit: Pick<Ambulancia, 'estado' | 'conectada'>,
): CitizenUnitStatus {
  return unitIsConnected(unit) ? citizenUnitStatus(unit.estado) : 'maintenance';
}

/**
 * The server's rule for who receives a NEW request (EP-04.F2.US1): the unit is
 * available, its driver is connected and it has signal. The front mirrors it to
 * count the units a request would reach, so "Pedir ambulancia" is offered only
 * when the server would notify somebody. The server stays the arbiter: the last
 * such unit can disconnect between this count and the click.
 */
export function unitCanReceiveRequest(
  unit: Pick<Ambulancia, 'estado' | 'conectada' | 'sinSenal'>,
): boolean {
  return unit.estado === 'AVAILABLE' && unitIsConnected(unit) && unit.sinSenal !== true;
}

export function countUnitsByStatus(units: Ambulancia[]): Record<CitizenUnitStatus, number> {
  const counts: Record<CitizenUnitStatus, number> = { free: 0, busy: 0, maintenance: 0 };
  for (const unit of units) {
    counts[citizenUnitBucket(unit)] += 1;
  }
  return counts;
}

/**
 * A unit that stopped reporting its position (EP-04.F1.US1). Signal is DATA
 * about the position feed, not a fourth availability: the unit keeps its state
 * (free/busy) and stays on the map at its last known position, so this is a
 * separate question from `citizenUnitStatus`.
 */
export function unitHasLostSignal(unit: Pick<Ambulancia, 'sinSenal'>): boolean {
  return unit.sinSenal === true;
}

/** How the UI names a unit without signal: legend row and nearby list. */
export const UNIT_NO_SIGNAL_LABEL = 'Sin señal';

/**
 * Circular swatch of the "Sin señal" legend row. It reads the same `--nv-idle`
 * gray the map pin uses (`.nv-marker--nosignal`), so the two cannot drift.
 */
export const UNIT_NO_SIGNAL_MARKER_CLASS = 'bg-idle text-white';

export interface NearbyAmbulance {
  ambulance: Ambulancia;
  status: CitizenUnitStatus;
  distanceKm: number;
  etaMin: number;
  /**
   * Secondary line: the ETA when free, the reason it is not, otherwise. A unit
   * without signal says so instead: its position is the last known one, so an
   * arrival time computed from it would be a promise nobody can keep.
   */
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
      const status = citizenUnitBucket(ambulance);
      const etaMin = etaMinutes(from, ambulance.ubicacion);
      return {
        ambulance,
        status,
        distanceKm: km,
        etaMin,
        detail: unitHasLostSignal(ambulance)
          ? UNIT_NO_SIGNAL_LABEL
          : status === 'free'
            ? `${formatDistance(km)} · ${etaMin} min`
            : status === 'maintenance'
              ? 'Fuera de servicio'
              : 'Atendiendo un servicio',
      };
    })
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);
}
