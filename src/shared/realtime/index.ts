import { DevRelayAdapter } from './dev-relay-adapter';
import type { RealtimePort } from './port';

let singleton: RealtimePort | undefined;

/**
 * Realtime transport for the app.
 *
 * The same relay protocol is served in dev by `vite-plugin-dev-realtime.ts` and
 * in production by the `RealtimeRoom` Durable Object mounted on the same Worker,
 * so `window.location.host` resolves in both environments.
 *
 * TODO(realtime): once the backend exists, return a STOMP adapter backed by
 * `src/services/stompClient.ts` instead of DevRelayAdapter. Every feature
 * depends only on RealtimePort, so this is the single swap point.
 */
export function getRealtimePort(): RealtimePort {
  if (singleton === undefined) {
    singleton = new DevRelayAdapter();
  }
  return singleton;
}

export * from './messages';
export type { RealtimeHandler, RealtimePort, RealtimeState } from './port';
export { DevRelayAdapter };
