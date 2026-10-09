/** Seconds after the arrival when the server confirms it for the citizen. */
export const AUTO_CONFIRM_SECONDS = 60;

/** Whole seconds left until the automatic confirmation, never negative. */
export function autoConfirmSecondsLeft(arrivedAt: number, now: number): number {
  return Math.max(0, Math.ceil((arrivedAt + AUTO_CONFIRM_SECONDS * 1000 - now) / 1000));
}

/** "m:ss" label for a countdown in seconds. */
export function formatSecondsLeft(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}
