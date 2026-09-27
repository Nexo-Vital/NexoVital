/**
 * Mock mapping from a driver session user to the ambulance unit it drives.
 * The real backend returns this from the driver's profile; unit tests and the
 * demo can override it with the `ambulanceId` prop on DriverConsolePage.
 *
 * The five seeded demo conductors (`src/mocks/demo-users.ts`) each drive a
 * DIFFERENT unit. Collapsing them onto AMB-01 (the old behaviour) made "the
 * first unit to accept wins" impossible to demo: every signed-in driver was the
 * same ambulance, so at most one account could ever answer.
 */
export const DRIVER_AMBULANCE_BY_USER: Record<string, string> = {
  'usr-driver': 'A-07',
  'usr-demo-conductor-1': 'A-07',
  'usr-demo-conductor-2': 'A-12',
  'usr-demo-conductor-3': 'A-03',
  'usr-demo-conductor-4': 'A-09',
  'usr-demo-conductor-5': 'A-15',
};

export const FALLBACK_DRIVER_AMBULANCE_ID = 'A-07';

export function resolveDriverAmbulanceId(userId: string | null | undefined): string {
  if (userId && DRIVER_AMBULANCE_BY_USER[userId]) {
    return DRIVER_AMBULANCE_BY_USER[userId];
  }
  return FALLBACK_DRIVER_AMBULANCE_ID;
}

/**
 * Resolves the driver's OWN unit from a fleet list by matching `conductorId`.
 *
 * <p>Superseded off-demo (FIX3): the general fleet read-model no longer exposes
 * any driver id, so the driver's unit comes from the server-scoped
 * `GET /api/v1/flota/ambulancias/mia` (`fetchMiAmbulancia`). This helper is kept
 * for demo fixtures and its own unit tests; it is no longer the page's path.
 *
 * Returns `null` when the fleet has no unit for this driver.
 */
export function resolveDriverAmbulanceIdFromFleet(
  unidades: { id: string; conductorId?: string }[],
  userId: string | null | undefined,
): string | null {
  if (!userId) {
    return null;
  }
  return unidades.find((unidad) => unidad.conductorId === userId)?.id ?? null;
}
