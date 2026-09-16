import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DevRelayAdapter } from './dev-relay-adapter';
import { DESTINATIONS, REALTIME_PATH } from './messages';
import type { RealtimeState } from './port';

type Listener = (event: { data?: unknown }) => void;

/** Minimal WebSocket double: tests drive open/message/close explicitly. */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  readonly sent: string[] = [];
  readonly url: string;
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close', {});
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit('open', {});
  }

  message(data: unknown): void {
    this.emit('message', { data });
  }

  private emit(type: string, event: { data?: unknown }): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

describe('DevRelayAdapter', () => {
  let adapter: DevRelayAdapter | null = null;

  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    adapter?.disconnect();
    adapter = null;
    vi.unstubAllGlobals();
  });

  it('derives the relay URL from the current page origin', () => {
    adapter = new DevRelayAdapter();
    adapter.connect();

    const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    expect(FakeWebSocket.instances[0]?.url).toBe(
      `${scheme}//${window.location.host}${REALTIME_PATH}`,
    );
  });

  it('tracks connection state transitions', () => {
    adapter = new DevRelayAdapter();
    const states: RealtimeState[] = [];
    adapter.onStateChange((state) => states.push(state));

    adapter.connect();
    FakeWebSocket.instances[0]?.open();

    expect(adapter.state).toBe('CONNECTED');
    expect(states).toEqual(['DISCONNECTED', 'STALE', 'CONNECTED']);
  });

  it('dispatches envelopes only to matching destination subscribers', () => {
    adapter = new DevRelayAdapter();
    adapter.connect();
    const socket = FakeWebSocket.instances[0];
    socket?.open();

    const solicitudes: unknown[] = [];
    const flota: unknown[] = [];
    adapter.subscribe(DESTINATIONS.solicitudes, (payload) => solicitudes.push(payload));
    adapter.subscribe(DESTINATIONS.flota, (payload) => flota.push(payload));

    socket?.message(
      JSON.stringify({
        destination: DESTINATIONS.solicitudes,
        payload: { type: 'solicitud.broadcast' },
      }),
    );

    expect(solicitudes).toEqual([{ type: 'solicitud.broadcast' }]);
    expect(flota).toHaveLength(0);
  });

  it('queues publishes until the socket opens', () => {
    adapter = new DevRelayAdapter();
    adapter.connect();
    const socket = FakeWebSocket.instances[0];

    adapter.publish(DESTINATIONS.flota, { ambulanceId: 'AMB-01' });
    expect(socket?.sent).toHaveLength(0);

    socket?.open();
    expect(socket?.sent).toHaveLength(1);
    expect(JSON.parse(socket?.sent[0] ?? '{}').destination).toBe(DESTINATIONS.flota);
  });

  it('stops reconnecting after disconnect', () => {
    vi.useFakeTimers();
    adapter = new DevRelayAdapter();
    adapter.connect();
    const socket = FakeWebSocket.instances[0];
    socket?.open();
    socket?.close();

    adapter.disconnect();
    vi.advanceTimersByTime(5000);

    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.useRealTimers();
  });
});
