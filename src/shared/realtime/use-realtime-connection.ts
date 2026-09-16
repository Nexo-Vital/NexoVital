import { useEffect } from 'react';
import { getRealtimePort } from './index';

/**
 * Owns the realtime port lifecycle for the signed-in shell. Mounted once by
 * AppShell so every feature can just subscribe. The relay is available in dev
 * and in production, so this always connects.
 */
export function useRealtimeConnection(): void {
  useEffect(() => {
    const port = getRealtimePort();
    port.connect();
    return () => {
      port.disconnect();
    };
  }, []);
}
