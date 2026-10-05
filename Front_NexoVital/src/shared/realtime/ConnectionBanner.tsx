import { WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { RealtimePort } from './port';

/**
 * How long the channel must stay down before the banner shows. The transport
 * starts as "not connected" and takes a moment to open, and a healthy socket can
 * blink on a network change: without this pause every page load would flash a
 * warning that means nothing.
 */
export const CONNECTION_BANNER_DELAY_MS = 1500;

interface ConnectionBannerProps {
  /** `null` switches the banner off (demo mode has no backend channel to lose). */
  port: RealtimePort | null;
}

/**
 * Visible "we are offline" signal for the realtime channel (EP-02.F1.US2).
 *
 * While the channel is down the map still shows the last state it received, and
 * nothing on screen says so: the user would trust a picture that stopped
 * updating. This strip says it plainly and goes away by itself when the channel
 * is back, at which point the screens re-read their snapshots
 * (`useRealtimeReconnect`).
 */
export function ConnectionBanner({ port }: ConnectionBannerProps) {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (!port) {
      setOffline(false);
      return;
    }
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = port.onStateChange((state) => {
      clearTimeout(timeoutId);
      timeoutId = undefined;
      if (state === 'CONNECTED') {
        setOffline(false);
        return;
      }
      timeoutId = setTimeout(() => setOffline(true), CONNECTION_BANNER_DELAY_MS);
    });
    return () => {
      clearTimeout(timeoutId);
      unsubscribe();
    };
  }, [port]);

  if (!offline) {
    return null;
  }
  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-2 border-nv-amber border-b bg-nv-amber/25 px-8 py-2 font-medium text-nv-navy text-sm"
    >
      <WifiOff className="size-4 shrink-0" aria-hidden />
      <span>Sin conexión en tiempo real. Reconectando… Lo que ves puede estar desactualizado.</span>
    </div>
  );
}
