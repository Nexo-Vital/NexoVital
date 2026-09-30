import type { RealtimeEnvelope } from './messages';

/** Connection health surfaced by the app-shell channel badge. */
export type RealtimeState = 'CONNECTED' | 'STALE' | 'DISCONNECTED';

export type RealtimeHandler<T = unknown> = (payload: T, envelope: RealtimeEnvelope<T>) => void;

/**
 * Transport-agnostic realtime port.
 *
 * The app only depends on this interface, so the dev WebSocket adapter
 * (`dev-relay-adapter.ts`) can be swapped for the real STOMP adapter
 * (`stomp-adapter.ts`) without touching feature code.
 */
export interface RealtimePort {
  readonly state: RealtimeState;
  /** Open the transport. Idempotent. */
  connect(): void;
  /** Close the transport and stop reconnecting. */
  disconnect(): void;
  /** Publish an envelope `{ destination, payload }`. */
  publish<T>(destination: string, payload: T): void;
  /** Subscribe by destination; returns an unsubscribe function. */
  subscribe<T>(destination: string, handler: RealtimeHandler<T>): () => void;
  /** Observe connection-state transitions; replays the current state on subscribe. */
  onStateChange(handler: (state: RealtimeState) => void): () => void;
}
