/** 24h wall clock for the app shell, e.g. "14:07:32". */
export function formatClock(date: Date): string {
  return date.toLocaleTimeString('en-GB', { hour12: false });
}

/** Elapsed time as mm:ss (or h:mm:ss past one hour) from an ISO timestamp. */
export function formatElapsed(fromIso: string, now: Date): string {
  const diffMs = Math.max(0, now.getTime() - new Date(fromIso).getTime());
  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/** Percentage of a requirement that is currently available, clamped to 0..999. */
export function stockRatioPercent(available: number, required: number): number {
  if (required <= 0) {
    return 0;
  }
  return Math.min(999, Math.round((available / required) * 100));
}

/** Countdown as mm:ss until an ISO timestamp; never negative. */
export function formatCountdown(targetIso: string, now: Date): string {
  const diffMs = Math.max(0, new Date(targetIso).getTime() - now.getTime());
  const totalSeconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(minutes)}:${pad(seconds)}`;
}
