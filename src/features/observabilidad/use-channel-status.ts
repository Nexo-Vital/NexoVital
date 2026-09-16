import { useEffect, useState } from 'react';
import { getRealtimePort } from '@/shared/realtime';
import type { ChannelState } from '@/types/domain';

export interface ChannelStatus {
  state: ChannelState;
  latencyMs: number | null;
}

/**
 * Channel health for the app shell.
 *
 * The badge mirrors the realtime port's real state (CONNECTED / STALE /
 * DISCONNECTED). The same relay is served in dev and in production, so there is
 * no mock fallback; latency stays null until the transport measures it.
 */
export function useChannelStatus(): ChannelStatus {
  const port = getRealtimePort();
  const [state, setState] = useState<ChannelState>(() => port.state);

  useEffect(() => port.onStateChange((next) => setState(next)), [port]);

  return { state, latencyMs: null };
}
