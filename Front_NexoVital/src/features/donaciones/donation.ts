import { create } from 'zustand';
import {
  type CitizenCenterLevel,
  centerLevel,
  centerShortName,
  mostUrgentItem,
} from '@/features/ciudadano/citizen-view';
import { centroSemaforo, trafficLight } from '@/features/recursos/traffic-light';
import type { CentroAyuda, InventarioItem, TrafficLight } from '@/types/domain';

/**
 * Donation flow, MOCK only: the fixtures are the initial load and a confirmed
 * donation mutates the front state. Nothing here talks to `/api/v1/mapa`; with
 * the demo flag off the centers carry no inventory, so the flow degrades to
 * "sin requerimientos declarados" instead of faking data.
 *
 * All the maths reuses the app's single threshold source (`traffic-light`): the
 * item level after a donation is `trafficLight(disponible, requerido)` and the
 * center level is always the worst item (`centroSemaforo`), never a second rule.
 */

/** A confirmed donation: how much of which item went to which center. */
export interface Donation {
  centroId: string;
  itemId: string;
  amount: number;
}

/**
 * A donation plus the center level it moved FROM. The after level is derived
 * from the updated center, so only the "before" has to be remembered for c9's
 * "Antes estaba en crítico".
 */
export interface DonationRecord extends Donation {
  beforeCenterLevel: TrafficLight;
}

/** Applies a donation to one item and recomputes that item's traffic light. */
export function applyDonation(centro: CentroAyuda, itemId: string, amount: number): CentroAyuda {
  return {
    ...centro,
    items: centro.items.map((item) => {
      if (item.id !== itemId) {
        return item;
      }
      const disponible = item.disponible + amount;
      return { ...item, disponible, semaforo: trafficLight(disponible, item.requerido) };
    }),
  };
}

/**
 * The modal's options, most critical first (lowest available/required ratio):
 * every declared item that is not fully covered yet. A GREEN item (70% to below
 * 100%) still has a gap, so it IS offered: otherwise a center could never reach
 * COMPLETE. Only COMPLETE items (100% or no requirement) are left out.
 */
export function donableItems(centro: CentroAyuda): InventarioItem[] {
  return centro.items
    .filter((item) => item.requerido > 0 && item.disponible < item.requerido)
    .sort((a, b) => a.disponible / a.requerido - b.disponible / b.requerido);
}

/** Rounded percentage capped at 100; 0 when nothing is required. */
export function barPercent(available: number, required: number): number {
  if (required <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((available / required) * 100));
}

/** Traffic-light label, capitalised for the preview step ("Crítico → Alerta"). */
export const LEVEL_LABEL: Record<TrafficLight, string> = {
  RED: 'Crítico',
  AMBER: 'Alerta',
  GREEN: 'Estable',
  COMPLETE: 'Completo',
  NOT_DECLARED: 'Sin declarar',
};

/** Lower-case level for prose ("pasó de crítico a alerta"). */
export function levelWord(level: TrafficLight): string {
  return LEVEL_LABEL[level].toLowerCase();
}

export interface DonationPreview {
  item: InventarioItem;
  before: number;
  after: number;
  /** Item level before and after the prospective donation. */
  beforeLight: TrafficLight;
  afterLight: TrafficLight;
  /** Center level before and after (the worst item, so c9's chip transition). */
  beforeCenterLevel: TrafficLight;
  afterCenterLevel: TrafficLight;
  /** Bar segments as percentages, capped at 100. */
  beforePercent: number;
  afterPercent: number;
  /** The center's scarcest item AFTER the donation, for the follow-up copy. */
  nextScarce: InventarioItem | null;
}

/** Prospective result of donating `amount` of `itemId` to `centro`. */
export function previewDonation(
  centro: CentroAyuda,
  itemId: string,
  amount: number,
): DonationPreview | null {
  const item = centro.items.find((entry) => entry.id === itemId);
  if (!item) {
    return null;
  }
  const updated = applyDonation(centro, itemId, amount);
  const after = item.disponible + amount;
  return {
    item,
    before: item.disponible,
    after,
    beforeLight: item.semaforo,
    afterLight: trafficLight(after, item.requerido),
    beforeCenterLevel: centroSemaforo(centro),
    afterCenterLevel: centroSemaforo(updated),
    beforePercent: barPercent(item.disponible, item.requerido),
    afterPercent: barPercent(after, item.requerido),
    nextScarce: mostUrgentItem(updated),
  };
}

/**
 * The preview's outcome line, e.g. "Pasa a alerta: todavía le faltan kits de
 * higiene." The verb agrees with the scarce item's declared grammatical number,
 * the same rule the rail's need label uses.
 */
export function previewMessage(preview: DonationPreview): string {
  // "Pasa a" only when the centre level really changes; otherwise "Sigue en".
  const changed = preview.afterCenterLevel !== preview.beforeCenterLevel;
  const step = `${changed ? 'Pasa a' : 'Sigue en'} ${levelWord(preview.afterCenterLevel)}`;
  if (preview.afterCenterLevel === 'COMPLETE') {
    return `${step}: el centro ya tiene lo necesario.`;
  }
  const scarce = preview.nextScarce;
  if (!scarce) {
    return `${step}.`;
  }
  const name = scarce.nombre.toLowerCase();
  // The backend does not declare the grammatical number; without it the verb
  // would be guessed ("le falta alimentos"), so a number-neutral phrase is used.
  if (!scarce.grammaticalNumber) {
    return `${step}: todavía necesita ${name}.`;
  }
  const verb = scarce.grammaticalNumber === 'plural' ? 'faltan' : 'falta';
  return `${step}: todavía le ${verb} ${name}.`;
}

/**
 * The center's "what it needs most" sentence, literal to the mockup: "Hoy lo que
 * más necesita es agua potable." / "Ahora lo que más necesita son kits de
 * higiene." The tense changes after a donation and the verb follows the item's
 * grammatical number.
 */
export function scarceNote(centro: CentroAyuda, tense: 'today' | 'now'): string {
  const urgent = mostUrgentItem(centro);
  if (!urgent) {
    return centro.items.length > 0
      ? 'Ya tiene todo lo que necesita.'
      : 'Sin requerimientos declarados.';
  }
  const when = tense === 'today' ? 'Hoy' : 'Ahora';
  const name = urgent.nombre.toLowerCase();
  const verb = urgent.grammaticalNumber === 'plural' ? 'son' : 'es';
  return `${when} lo que más necesita ${verb} ${name}.`;
}

/**
 * The donated amount in prose: "40 bidones de agua potable" / "40 kits de
 * higiene" (the item name already starts with the unit, so it is not repeated).
 * With no declared unit the amount is written bare rather than inventing one.
 */
export function donationPhrase(item: InventarioItem, amount: number): string {
  const name = item.nombre.toLowerCase();
  if (!item.unidad) {
    return `${amount} ${name}`;
  }
  // "Kits de higiene" already starts with its unit, so the name is used whole
  // ("40 kits de higiene"); otherwise the unit leads ("40 bidones de agua potable").
  return name.startsWith(item.unidad.toLowerCase())
    ? `${amount} ${name}`
    : `${amount} ${item.unidad} de ${name}`;
}

/** The c9 toast: the real donated amount and the center's real level change. */
export function donationToast(
  centro: CentroAyuda,
  record: DonationRecord,
  item: InventarioItem,
): string {
  const afterLevel = centroSemaforo(centro);
  return `Donaste ${donationPhrase(item, record.amount)}. ${centerShortName(centro)} pasó de ${levelWord(record.beforeCenterLevel)} a ${levelWord(afterLevel)}.`;
}

/** "a 900 m de ti" / "a 2,1 km de ti", from the computed ground distance. */
export function formatDistanceTo(km: number): string {
  if (km < 1) {
    return `a ${Math.round(km * 1000)} m de ti`;
  }
  return `a ${km.toFixed(1).replace('.', ',')} km de ti`;
}

const LEVEL_SEVERITY: Record<CitizenCenterLevel, number> = {
  critical: 4,
  alert: 3,
  stable: 2,
  complete: 1,
};

/**
 * The centers the donation picker offers, worst first. A center qualifies when it
 * has at least one declared item not fully covered (`donableItems`), because a
 * center with nothing declared — or with everything complete — needs no donation. The
 * order is the worst level first, ties broken by the scarcest item's ratio, so
 * the citizen still sees the most urgent option at the top. An empty list is the
 * honest "nothing to donate to" the rail disables the action on.
 *
 * NOTE: this deliberately does NOT pick a center. "Donar suministros" must wait
 * for the citizen's choice (list or map); the selection is never made for them.
 */
export function donableCenters(centros: CentroAyuda[]): CentroAyuda[] {
  const severityOf = (centro: CentroAyuda) => LEVEL_SEVERITY[centerLevel(centro) ?? 'stable'];
  const ratioOf = (centro: CentroAyuda) => {
    const urgent = mostUrgentItem(centro);
    return urgent ? urgent.disponible / urgent.requerido : Number.POSITIVE_INFINITY;
  };
  return centros
    .filter((centro) => donableItems(centro).length > 0)
    .sort((a, b) => severityOf(b) - severityOf(a) || ratioOf(a) - ratioOf(b));
}

interface DonationState {
  /** Centers whose inventory changed through a donation, keyed by center id. */
  updated: Record<string, CentroAyuda>;
  /** Applies the donation and returns the updated center. */
  donate: (centro: CentroAyuda, itemId: string, amount: number) => CentroAyuda;
  reset: () => void;
}

export const useDonationStore = create<DonationState>((set) => ({
  updated: {},
  donate: (centro, itemId, amount) => {
    const next = applyDonation(centro, itemId, amount);
    set((state) => ({ updated: { ...state.updated, [centro.id]: next } }));
    return next;
  },
  reset: () => set({ updated: {} }),
}));

/** Overlays the donated centers on the base list, preserving its order. */
export function withDonations(
  centros: CentroAyuda[],
  updated: Record<string, CentroAyuda>,
): CentroAyuda[] {
  return centros.map((centro) => updated[centro.id] ?? centro);
}
