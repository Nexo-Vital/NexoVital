import { isDemoMode } from '../../services/apiClient';
import { DevRelayAdapter } from './dev-relay-adapter';
import type { RealtimePort } from './port';
import { StompRealtimeAdapter } from './stomp-adapter';

let singleton: RealtimePort | undefined;

/**
 * Realtime transport for the app, chosen at the single swap point.
 *
 * In the deployed demo build (`VITE_DEMO_MODE=1`) there is no backend, so it
 * keeps the in-Worker relay (`RealtimeRoom` Durable Object). Everywhere else the
 * real backend exists and it uses STOMP over WebSocket (`/ws`), implemented by
 * `StompRealtimeAdapter` (task 244). Every feature depends only on RealtimePort,
 * so this stays the one place the transport is decided.
 */
export function getRealtimePort(): RealtimePort {
  if (singleton === undefined) {
    singleton = isDemoMode() ? new DevRelayAdapter() : new StompRealtimeAdapter();
  }
  return singleton;
}

/** Test seam: drop the cached port so each case resolves the transport fresh. */
export function resetRealtimePort(): void {
  singleton = undefined;
}

export * from './messages';
export type { RealtimeHandler, RealtimePort, RealtimeState } from './port';
export {
  fromWireSolicitud,
  solicitudFrameFromWire,
  type WireSolicitudContext,
} from './solicitud-wire';
export { DevRelayAdapter, StompRealtimeAdapter };
