import { Client, type IMessage, type StompSubscription } from '@stomp/stompjs';
import SockJS from 'sockjs-client';
import { getToken } from '../../services/apiClient';
import type { RealtimeEnvelope } from './messages';
import type { RealtimeHandler, RealtimePort, RealtimeState } from './port';

/**
 * WebSocket/STOMP endpoint exposed by the backend (`/ws`, SockJS fallback).
 * Same-origin by default: in development the Vite proxy forwards `/ws` to the
 * backend. Deployments where the API lives on another origin set `VITE_WS_URL`
 * at build time (e.g. `wss://api.ejemplo.com/ws`).
 */
const STOMP_ENDPOINT = (import.meta.env.VITE_WS_URL as string | undefined) ?? '/ws';
const RECONNECT_DELAY_MS = 5000;

/**
 * STOMP client configuration. The bearer token travels in the CONNECT frame,
 * never in the handshake URL: the backend `StompAuthChannelInterceptor`
 * validates it there. Lifecycle callbacks are wired by the adapter constructor
 * so an injected client (tests) follows the same path as the real one.
 *
 * The token is deliberately NOT captured here: this module is evaluated with
 * the bundle, before login, so a module-level snapshot would be frozen empty.
 * The adapter reads it in `beforeConnect`, once per connect attempt.
 */
const STOMP_CONFIG = {
  webSocketFactory: () => new SockJS(STOMP_ENDPOINT),
  heartbeatIncoming: 10000,
  heartbeatOutgoing: 10000,
  reconnectDelay: RECONNECT_DELAY_MS,
} as const;

/**
 * RealtimePort backed by STOMP over WebSocket (SockJS fallback), the transport
 * the backend serves since task 244. It replaces `DevRelayAdapter` at the single
 * swap point in `index.ts`, so no feature code changes.
 *
 * The port was broadcast-only and its envelope is `{ destination, payload }`.
 * STOMP is destination-based: `publish(destination, payload)` sends the raw
 * payload to that destination, and `subscribe(destination, handler)` subscribes
 * to it. `dispatch` reconstructs the same `RealtimeEnvelope` from the incoming
 * frame so handlers keep their exact signature.
 *
 * The bearer token travels in the STOMP `CONNECT` frame (`connectHeaders`),
 * never in the handshake URL: `StompAuthChannelInterceptor` on the backend
 * validates it there.
 */
export class StompRealtimeAdapter implements RealtimePort {
  private currentState: RealtimeState = 'DISCONNECTED';
  private readonly client: Client;
  private readonly handlers = new Map<string, Set<RealtimeHandler>>();
  private readonly subscriptions = new Map<string, StompSubscription>();
  private readonly stateHandlers = new Set<(state: RealtimeState) => void>();
  private manuallyClosed = false;

  constructor(client?: Client) {
    this.client = client ?? new Client(STOMP_CONFIG);
    // Se ejecuta en cada intento de conexion y de reconexion: el token se lee
    // aqui, vigente en ese instante, y no al cargar el modulo. Si no hay token
    // se omite la cabecera Authorization en lugar de enviar un `Bearer` vacio.
    this.client.beforeConnect = () => {
      const token = getToken();
      this.client.connectHeaders = token ? { Authorization: `Bearer ${token}` } : {};
    };
    this.client.onConnect = () => {
      this.setState('CONNECTED');
      this.resubscribeAll();
    };
    this.client.onWebSocketClose = () => {
      this.setState(this.manuallyClosed ? 'DISCONNECTED' : 'STALE');
    };
    this.client.onStompError = (frame) => {
      console.error('[stomp] error STOMP', frame.headers);
    };
  }

  get state(): RealtimeState {
    return this.currentState;
  }

  connect(): void {
    if (this.client.active) {
      return;
    }
    this.manuallyClosed = false;
    this.setState('STALE');
    this.client.activate();
  }

  disconnect(): void {
    this.manuallyClosed = true;
    this.subscriptions.clear();
    void this.client.deactivate();
    this.setState('DISCONNECTED');
  }

  publish<T>(destination: string, payload: T): void {
    if (!this.client.connected) {
      // No outbox: STOMP does not retain messages and the port contract does not
      // promise queuing. A publish while offline is dropped, as on the backend.
      return;
    }
    this.client.publish({ destination, body: JSON.stringify(payload) });
  }

  subscribe<T>(destination: string, handler: RealtimeHandler<T>): () => void {
    const set = this.handlers.get(destination) ?? new Set<RealtimeHandler>();
    set.add(handler as RealtimeHandler);
    this.handlers.set(destination, set);
    this.ensureSubscribed(destination);

    return () => {
      set.delete(handler as RealtimeHandler);
      if (set.size === 0) {
        this.handlers.delete(destination);
        this.subscriptions.get(destination)?.unsubscribe();
        this.subscriptions.delete(destination);
      }
    };
  }

  onStateChange(handler: (state: RealtimeState) => void): () => void {
    this.stateHandlers.add(handler);
    handler(this.currentState);
    return () => {
      this.stateHandlers.delete(handler);
    };
  }

  /** Subscribe the destination on STOMP only once a live connection exists. */
  private ensureSubscribed(destination: string): void {
    if (!this.client.connected || this.subscriptions.has(destination)) {
      return;
    }
    const subscription = this.client.subscribe(destination, (message) => {
      this.dispatch(destination, message);
    });
    this.subscriptions.set(destination, subscription);
  }

  /** Re-establish every live subscription after a reconnect. */
  private resubscribeAll(): void {
    this.subscriptions.clear();
    for (const destination of this.handlers.keys()) {
      this.ensureSubscribed(destination);
    }
  }

  private dispatch(destination: string, message: IMessage): void {
    const set = this.handlers.get(destination);
    if (!set) {
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(message.body) as unknown;
    } catch {
      return;
    }
    const envelope: RealtimeEnvelope = { destination, payload };
    for (const handler of set) {
      handler(payload, envelope);
    }
  }

  private setState(next: RealtimeState): void {
    if (this.currentState === next) {
      return;
    }
    this.currentState = next;
    for (const handler of this.stateHandlers) {
      handler(next);
    }
  }
}

export { STOMP_ENDPOINT };
