import type { Ambulancia } from '@/types/domain';

/**
 * Human handle of an ambulance: its plate (`ABC101`), never the internal id.
 *
 * Off demo the id is a UUID, so painting it as the unit's name gives the user a
 * long, unreadable identifier. The plate is the short, real handle the domain
 * already carries (and the one the user recognises), so every user-facing unit
 * label goes through here. Falls back to the id only when a unit arrives with a
 * blank plate.
 *
 * This is the SINGLE definition of the plate rule. It is deliberately neutral
 * (no React, no feature import) so a plain module such as the map marker builder
 * can share it without depending on a `.tsx` that also exports components.
 */
export function unitPlateLabel(unit: Pick<Ambulancia, 'id' | 'placa'>): string {
  const plate = unit.placa.trim();
  return plate === '' ? unit.id : plate;
}
