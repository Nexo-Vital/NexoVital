import { useEffect, useRef } from 'react';
import type { RealtimePort } from './port';

/**
 * Runs `onReconnect` every time the realtime channel comes BACK after a drop
 * (CONNECTED -> STALE/DISCONNECTED -> CONNECTED).
 *
 * The broker does not retain messages: whatever was published while the channel
 * was down never arrives. A screen that only listens would keep showing the
 * state it had before the drop (for example a unit still painted as available
 * after it took a mission), so the owner of a snapshot uses this hook to read
 * that snapshot again.
 *
 * It does NOT fire on the first connection: the mount effects already read the
 * snapshot then. A `null` port disables it, which is how callers switch it off
 * for injected data and demo mode.
 */
export function useRealtimeReconnect(port: RealtimePort | null, onReconnect: () => void): void {
  // The latest callback is kept in a ref so a new function identity on every
  // render does not tear down and re-create the state subscription.
  const callback = useRef(onReconnect);
  useEffect(() => {
    callback.current = onReconnect;
  }, [onReconnect]);

  useEffect(() => {
    if (!port) {
      return;
    }
    let wasConnected = false;
    let dropped = false;
    // `onStateChange` replays the current state on subscribe, so an already
    // connected port just marks `wasConnected` without firing.
    return port.onStateChange((state) => {
      if (state !== 'CONNECTED') {
        dropped = wasConnected;
        return;
      }
      if (wasConnected && dropped) {
        callback.current();
      }
      wasConnected = true;
      dropped = false;
    });
  }, [port]);
}
