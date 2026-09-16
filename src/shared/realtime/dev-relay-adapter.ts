import { REALTIME_PATH, type RealtimeEnvelope } from './messages';
import type { RealtimeHandler, RealtimePort, RealtimeState } from './port';

const RECONNECT_DELAY_MS = 2000;

/** Relay URL derived from the page: same host/port, `REALTIME_PATH`. */
function relayUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}${REALTIME_PATH}`;
}

/**
 * RealtimePort over the WebSocket relay. Broadcast-only transport: the relay
 * fans every message out to all clients and acts as the C2 arbiter (the Vite
 * dev plugin locally, the Durable Object in production). Messages published
 * while offline are queued and flushed on connect.
 */
export class DevRelayAdapter implements RealtimePort {
  private currentState: RealtimeState = 'DISCONNECTED';
  private socket: WebSocket | null = null;
  private readonly handlers = new Map<string, Set<RealtimeHandler>>();
  private readonly stateHandlers = new Set<(state: RealtimeState) => void>();
  private readonly outbox: string[] = [];
  private reconnectTimer: number | null = null;
  private manuallyClosed = false;

  get state(): RealtimeState {
    return this.currentState;
  }

  connect(): void {
    if (typeof WebSocket === 'undefined') {
      return;
    }
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.manuallyClosed = false;
    this.setState('STALE');

    const socket = new WebSocket(relayUrl());
    this.socket = socket;

    socket.addEventListener('open', () => {
      if (this.socket !== socket) {
        return;
      }
      this.setState('CONNECTED');
      this.flushOutbox();
    });
    socket.addEventListener('message', (event) => this.dispatch(String(event.data)));
    socket.addEventListener('error', () => {
      if (this.socket === socket) {
        this.setState('STALE');
      }
    });
    socket.addEventListener('close', () => {
      if (this.socket !== socket) {
        return;
      }
      this.socket = null;
      this.setState('DISCONNECTED');
      if (!this.manuallyClosed) {
        this.scheduleReconnect();
      }
    });
  }

  disconnect(): void {
    this.manuallyClosed = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.setState('DISCONNECTED');
  }

  publish<T>(destination: string, payload: T): void {
    const text = JSON.stringify({ destination, payload } satisfies RealtimeEnvelope<T>);
    if (this.isOpen()) {
      this.socket?.send(text);
      return;
    }
    // Keep the demo action: flush it as soon as the relay is reachable again.
    this.outbox.push(text);
    if (!this.socket) {
      this.connect();
    }
  }

  subscribe<T>(destination: string, handler: RealtimeHandler<T>): () => void {
    const set = this.handlers.get(destination) ?? new Set<RealtimeHandler>();
    set.add(handler as RealtimeHandler);
    this.handlers.set(destination, set);
    return () => {
      set.delete(handler as RealtimeHandler);
    };
  }

  onStateChange(handler: (state: RealtimeState) => void): () => void {
    this.stateHandlers.add(handler);
    handler(this.currentState);
    return () => {
      this.stateHandlers.delete(handler);
    };
  }

  private isOpen(): boolean {
    return typeof WebSocket !== 'undefined' && this.socket?.readyState === WebSocket.OPEN;
  }

  private flushOutbox(): void {
    if (!this.isOpen()) {
      return;
    }
    const pending = this.outbox.splice(0, this.outbox.length);
    for (const text of pending) {
      this.socket?.send(text);
    }
  }

  private dispatch(raw: string): void {
    let envelope: RealtimeEnvelope;
    try {
      envelope = JSON.parse(raw) as RealtimeEnvelope;
    } catch {
      return;
    }
    if (!envelope || typeof envelope.destination !== 'string') {
      return;
    }
    const set = this.handlers.get(envelope.destination);
    if (!set) {
      return;
    }
    for (const handler of set) {
      handler(envelope.payload, envelope);
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

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) {
      return;
    }
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.manuallyClosed) {
        this.connect();
      }
    }, RECONNECT_DELAY_MS);
  }
}
