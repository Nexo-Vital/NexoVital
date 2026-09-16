import { Client, type IMessage } from '@stomp/stompjs';
import SockJS from 'sockjs-client';
import { getToken } from './apiClient';

/**
 * Cliente STOMP de Nexo Vital.
 *
 * Se conecta a `/ws` (proxy de Vite en dev → ws://localhost:8080).
 * Usa SockJS como transporte de respaldo; si el servidor expone STOMP
 * nativo sobre WebSocket también se negocia automáticamente.
 *
 * Canales definidos en contract/README.md:
 *   /topic/emergencias/{id}   - actualización de emergencia
 *   /topic/emergencias        - nueva emergencia
 *   /topic/flota              - flota en vivo
 *   /topic/suministros        - inventario + semáforo
 *   /queue/solicitudes        - broadcast de solicitudes (conductor)
 */
const createStompClient = (): Client => {
  const client = new Client({
    webSocketFactory: () => new SockJS('/ws'),
    connectHeaders: {
      Authorization: `Bearer ${getToken() ?? ''}`,
    },
    heartbeatIncoming: 10000,
    heartbeatOutgoing: 10000,
    reconnectDelay: 5000,
    onConnect: () => {
      console.info('[stomp] conectado');
    },
    onWebSocketClose: () => {
      console.warn('[stomp] conexión cerrada; reintentando en 5s');
    },
    onStompError: (frame) => {
      console.error('[stomp] error STOMP', frame.headers);
    },
  });
  client.activate();
  return client;
};

export type { IMessage };

export default createStompClient;
