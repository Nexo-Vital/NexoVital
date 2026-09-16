/**
 * Mock mapping from a driver session user to the ambulance unit it drives.
 * The real backend returns this from the driver's profile; unit tests and the
 * demo can override it with the `ambulanceId` prop on DriverConsolePage.
 */
export const DRIVER_AMBULANCE_BY_USER: Record<string, string> = {
  'usr-driver': 'AMB-01',
};

export const FALLBACK_DRIVER_AMBULANCE_ID = 'AMB-01';

export function resolveDriverAmbulanceId(userId: string | null | undefined): string {
  if (userId && DRIVER_AMBULANCE_BY_USER[userId]) {
    return DRIVER_AMBULANCE_BY_USER[userId];
  }
  return FALLBACK_DRIVER_AMBULANCE_ID;
}
