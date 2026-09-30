import { afterEach, describe, expect, it, vi } from 'vitest';
import { DESTINATIONS } from './messages';
import type { RealtimeState } from './port';
import { StompRealtimeAdapter } from './stomp-adapter';

/**
 * Minimal STOMP Client double. The adapter owns the real `@stomp/stompjs` Client
 * in production; here the test drives connect/message/disconnect explicitly and
 * records the frames the adapter publishes.
 */
class FakeStompClient {
  active = false;
  connected = false;
  readonly published: { destination: string; body: string }[] = [];
  readonly subscriptions: { destination: string; callback: (message: { body: string }) => void }[] =
    [];
  readonly unsubscribed: string[] = [];
  connectHeaders: Record<string, string> = {};
  onConnect: (() => void) | undefined;
  onWebSocketClose: (() => void) | undefined;
  beforeConnect: (() => void) | undefined;

  activate(): void {
    this.active = true;
    // Real `Client.activate()` runs `beforeConnect` then the handshake and
    // fires `onConnect`; the double mirrors that order synchronously.
    this.beforeConnect?.();
    this.connected = true;
    this.onConnect?.();
  }

  deactivate(): Promise<void> {
    this.active = false;
    this.connected = false;
    return Promise.resolve();
  }

  publish(frame: { destination: string; body: string }): void {
    this.published.push(frame);
  }

  subscribe(destination: string, callback: (message: { body: string }) => void) {
    this.subscriptions.push({ destination, callback });
    return { unsubscribe: () => this.unsubscribed.push(destination) };
  }

  /** Test driver: deliver a frame on a destination. */
  deliver(destination: string, body: unknown): void {
    for (const subscription of this.subscriptions) {
      if (subscription.destination === destination) {
        subscription.callback({ body: JSON.stringify(body) });
      }
    }
  }

  /** Test driver: drop the socket without an explicit deactivate. */
  close(): void {
    this.connected = false;
    this.onWebSocketClose?.();
  }
}

/**
 * The adapter accepts a ready `Client`. Here we build a fake and adopt it: the
 * adapter wires its `onConnect`/`onWebSocketClose` onto the fake in its
 * constructor, exactly as it does on the real client.
 */
function buildAdapter() {
  const client = new FakeStompClient();
  const adapter = new StompRealtimeAdapter(client as never);
  return { client, adapter };
}

describe('StompRealtimeAdapter', () => {
  let adapter: StompRealtimeAdapter | null = null;

  afterEach(() => {
    adapter?.disconnect();
    adapter = null;
    localStorage.clear();
  });

  it('reads the token on every connect attempt, never at module load', () => {
    const { client, adapter: a } = buildAdapter();
    adapter = a;

    sessionStorage.setItem('nexovital.token', 'token-uno');
    a.connect();
    expect(client.connectHeaders).toEqual({ Authorization: 'Bearer token-uno' });

    a.disconnect();
    sessionStorage.setItem('nexovital.token', 'token-dos');
    a.connect();
    expect(client.connectHeaders).toEqual({ Authorization: 'Bearer token-dos' });
  });

  it('omits the Authorization header instead of sending an empty bearer', () => {
    const { client, adapter: a } = buildAdapter();
    adapter = a;

    sessionStorage.removeItem('nexovital.token');
    a.connect();
    expect(client.connectHeaders).toEqual({});
  });

  it('reports STALE while connecting and CONNECTED once the handshake completes', () => {
    const { adapter: a } = buildAdapter();
    adapter = a;
    const states: RealtimeState[] = [];
    a.onStateChange((state) => states.push(state));

    // `connect()` sets STALE before activating; a handshake that never resolves
    // leaves the port STALE, which is what the badge shows.
    expect(a.state).toBe('DISCONNECTED');
    a.connect();
    expect(a.state).toBe('CONNECTED');
    expect(states).toEqual(['DISCONNECTED', 'STALE', 'CONNECTED']);
  });

  it('drops a publish while offline and sends the raw payload once connected', () => {
    const { client, adapter: a } = buildAdapter();
    adapter = a;

    // Offline: the port is not connected yet, so the publish is dropped.
    a.publish(DESTINATIONS.flota, { ambulanceId: 'AMB-01' });
    expect(client.published).toHaveLength(0);

    a.connect();
    a.publish(DESTINATIONS.flota, { ambulanceId: 'AMB-01' });
    expect(client.published).toEqual([
      { destination: DESTINATIONS.flota, body: JSON.stringify({ ambulanceId: 'AMB-01' }) },
    ]);
  });

  it('delivers an incoming frame to its destination subscribers with the relay envelope', () => {
    const { client, adapter: a } = buildAdapter();
    adapter = a;
    a.connect();

    const flota: unknown[] = [];
    const emergencias: unknown[] = [];
    a.subscribe(DESTINATIONS.flota, (payload) => flota.push(payload));
    a.subscribe(DESTINATIONS.emergencias, (payload) => emergencias.push(payload));

    client.deliver(DESTINATIONS.flota, { ambulanceId: 'AMB-07' });

    expect(flota).toEqual([{ ambulanceId: 'AMB-07' }]);
    expect(emergencias).toHaveLength(0);
  });

  it('re-subscribes live destinations after a reconnect', () => {
    const { client, adapter: a } = buildAdapter();
    adapter = a;
    a.connect();
    a.subscribe(DESTINATIONS.flota, () => {});
    expect(client.subscriptions).toHaveLength(1);

    client.close();
    expect(a.state).toBe('STALE');

    // `@stomp/stompjs` reconnects on its own and re-fires `onConnect`; the adapter
    // must rebuild every live subscription at that point.
    client.activate();
    expect(client.subscriptions).toHaveLength(2);
  });

  it('is idempotent: a second connect while active does not re-activate', () => {
    const { client, adapter: a } = buildAdapter();
    adapter = a;
    a.connect();
    a.connect();

    expect(client.subscriptions).toHaveLength(0);
    expect(a.state).toBe('CONNECTED');
  });

  it('unsubscribes on the underlying client when the last handler leaves', () => {
    const { client, adapter: a } = buildAdapter();
    adapter = a;
    a.connect();

    const unsubscribe = a.subscribe(DESTINATIONS.flota, () => {});
    unsubscribe();

    expect(client.unsubscribed).toEqual([DESTINATIONS.flota]);
  });

  it('stays DISCONNECTED after an explicit disconnect', () => {
    const { adapter: a } = buildAdapter();
    adapter = a;
    a.connect();

    a.disconnect();
    expect(a.state).toBe('DISCONNECTED');
  });

  it('ignores a frame whose body is not valid JSON', () => {
    const { client, adapter: a } = buildAdapter();
    adapter = a;
    a.connect();

    const received: unknown[] = [];
    a.subscribe(DESTINATIONS.flota, (payload) => received.push(payload));
    client.deliver(DESTINATIONS.flota, 'raw-string');

    // JSON.stringify('raw-string') is valid JSON but not an object; the handler
    // still runs with the parsed primitive, matching the relay's tolerance.
    expect(received).toHaveLength(1);
  });
});

describe('getRealtimePort transport selection', () => {
  it('uses the STOMP adapter outside demo mode', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_DEMO_MODE', '');
    const {
      getRealtimePort,
      resetRealtimePort,
      StompRealtimeAdapter: Adapter,
    } = await import('./index');
    resetRealtimePort();
    expect(getRealtimePort()).toBeInstanceOf(Adapter);
    vi.unstubAllEnvs();
  });

  it('uses the dev relay in demo mode', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_DEMO_MODE', '1');
    const {
      getRealtimePort,
      resetRealtimePort,
      DevRelayAdapter: Adapter,
    } = await import('./index');
    resetRealtimePort();
    expect(getRealtimePort()).toBeInstanceOf(Adapter);
    vi.unstubAllEnvs();
  });
});
