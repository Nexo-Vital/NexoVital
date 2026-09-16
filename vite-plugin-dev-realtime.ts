import type { Plugin } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
import { type ArbiterRequests, resolveArbiterMessages } from './src/shared/realtime/dev-arbiter';
import { REALTIME_PATH } from './src/shared/realtime/messages';

/**
 * Dev WebSocket relay for Nexo Vital.
 *
 * Two devices on the LAN (phone + desktop) need a rendezvous to demo the
 * CRUE -> driver flow. This plugin attaches a WebSocketServer to the Vite dev
 * server on `REALTIME_PATH` and:
 *
 *   1. broadcasts every incoming message to all connected clients, and
 *   2. acts as a FAKE ARBITER for rule C2 (one request -> one winner): the
 *      FIRST accept wins, later accepts get `request.already-taken`.
 *
 * It only runs on `vite` (apply: 'serve'), so it never touches the production
 * build. Production serves the same protocol from the `RealtimeRoom` Durable
 * Object (`worker/realtime-room.ts`). The arbitration logic lives in the
 * transport-free `dev-arbiter.ts` so it can be unit-tested and shared.
 */
export function devRealtimeRelay(): Plugin {
  return {
    name: 'nexovital:dev-realtime-relay',
    apply: 'serve',
    configureServer(server) {
      const httpServer = server.httpServer;
      if (!httpServer) {
        return;
      }

      const wss = new WebSocketServer({ noServer: true });
      /** requestId -> winning ambulanceId. A request with a winner is closed. */
      const winners = new Map<string, string>();
      /** requestId -> mode/target metadata, needed to enforce direct targeting. */
      const requests: ArbiterRequests = new Map();

      const broadcast = (raw: string): void => {
        for (const client of wss.clients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(raw);
          }
        }
      };

      httpServer.on('upgrade', (request, socket, head) => {
        const pathname = (request.url ?? '').split('?')[0];
        if (pathname !== REALTIME_PATH) {
          return;
        }
        wss.handleUpgrade(request, socket, head, (client) => {
          wss.emit('connection', client, request);
        });
      });

      wss.on('connection', (client) => {
        server.config.logger.info(`[dev-realtime] client connected (${wss.clients.size} online)`);
        client.on('message', (data) => {
          const raw = data.toString();
          for (const message of resolveArbiterMessages(raw, winners, requests)) {
            broadcast(message);
          }
        });
      });

      httpServer.on('close', () => {
        wss.close();
      });
    },
  };
}

export default devRealtimeRelay;
