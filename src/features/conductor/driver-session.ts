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
  'usr-driver': 'AMB-01',
  'usr-demo-conductor-1': 'AMB-01',
  'usr-demo-conductor-2': 'AMB-02',
  'usr-demo-conductor-3': 'AMB-03',
  'usr-demo-conductor-4': 'AMB-04',
  'usr-demo-conductor-5': 'AMB-05',
};

export const FALLBACK_DRIVER_AMBULANCE_ID = 'AMB-01';

export function resolveDriverAmbulanceId(userId: string | null | undefined): string {
  if (userId && DRIVER_AMBULANCE_BY_USER[userId]) {
    return DRIVER_AMBULANCE_BY_USER[userId];
  }
  return FALLBACK_DRIVER_AMBULANCE_ID;
}
