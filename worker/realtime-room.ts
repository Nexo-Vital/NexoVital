/// <reference types="@cloudflare/workers-types" />
import { type ArbiterRequests, resolveArbiterMessages } from '../src/shared/realtime/dev-arbiter';
import { REALTIME_PATH } from '../src/shared/realtime/messages';

/**
 * Durable Object that relays realtime frames between every connected client and
 * decides C2 request winners (first accept wins), mirroring the dev relay.
 *
 * The request lifecycle (accept/win, direct targeting, `solicitud.cancel` ->
 * `request.cancelled`) is NOT reimplemented here: this object drives the same
 * transport-free `resolveArbiterMessages` the Vite dev relay uses, so the
 * deployed demo and local dev cannot diverge on the wire.
 *
 * It deliberately uses the CLASSIC WebSocket API (`server.accept()`) instead of
 * the WebSocket Hibernation API. `accept()` keeps the object resident while a
 * socket is open, so the in-memory arbiter state (`winners` / `requests`)
 * survives the demo. Under hibernation the object can be evicted mid-session and
 * that state would silently reset, letting a second unit "win" a request that
 * was already taken.
 */
export class RealtimeRoom {
  private readonly sockets = new Set<WebSocket>();
  /** requestId -> winning ambulanceId. A request with a winner is closed. */
  private readonly winners = new Map<string, string>();
  /** requestId -> mode/target metadata, needed to enforce direct targeting. */
  private readonly requests: ArbiterRequests = new Map();

  async fetch(request: Request): Promise<Response> {
    if ((request.headers.get('Upgrade') ?? '').toLowerCase() !== 'websocket') {
      return new Response(`Expected ${REALTIME_PATH} to be requested with Upgrade: websocket`, {
        status: 426,
      });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    server.accept();
    this.sockets.add(server);

    server.addEventListener('message', (event: MessageEvent) => {
      const raw =
        typeof event.data === 'string'
          ? event.data
          : new TextDecoder().decode(event.data as ArrayBuffer);
      for (const message of resolveArbiterMessages(raw, this.winners, this.requests)) {
        this.broadcast(message);
      }
    });

    const forget = (): void => {
      this.sockets.delete(server);
    };
    server.addEventListener('close', forget);
    server.addEventListener('error', forget);

    return new Response(null, { status: 101, webSocket: client });
  }

  private broadcast(raw: string): void {
    for (const socket of this.sockets) {
      try {
        socket.send(raw);
      } catch {
        // A socket that throws is dead: drop it so it stops breaking the fan-out.
        this.sockets.delete(socket);
      }
    }
  }
}
