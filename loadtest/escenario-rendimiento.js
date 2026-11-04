// ==========================================================================
// Escenario de rendimiento — NexoVital (Sprint 2)
//
// Perfil aprobado (arquitectura ESC-7):
//   8 req/s sostenidos durante 15 minutos, p95 HTTP <= 500 ms,
//   p99 HTTP <= 1000 ms, tasa de error < 1 % y 0 respuestas 5xx.
//
// La volumetria sale de una sala de operaciones con 20 operadores que
// disparan una accion cada 5 s (4 req/s) con 2x de margen -> 8 req/s.
//
// Uso:
//   k6 run -e TOKEN=<jwt> escenario-rendimiento.js
//
// Corrida corta de humo (sin suscriptores):
//   k6 run -e DURACION=30s -e SUSCRIPTORES=0 -e TOKEN=<jwt> escenario-rendimiento.js
//
// El token se obtiene con POST /api/v1/sesiones y dura una hora. Es obligatorio:
// los GET privados responden 401 sin el, y el CONNECT STOMP exige
// Authorization: Bearer <jwt> o cierra con 1002.
//
// Variables de entorno:
//   BASE_URL      http://localhost:8080   base HTTP
//   WS_BASE       ws://localhost:8080/ws  base STOMP (SockJS)
//   TOKEN         <jwt>                   obligatorio si SUSCRIPTORES > 0
//   SUSCRIPTORES  10                      clientes STOMP concurrentes (0 = omitir)
//   DESTINOS      /topic/flota,...        topicos a los que se suscribe cada cliente
//   DURACION      15m                     meseta de la carga HTTP
//   SUB_DURACION  15m                     meseta de los suscriptores
//   RATE          8                       peticiones HTTP por segundo de la meseta
//   CONSECUTIVO   true                    activa el control de huecos
//
// El endpoint /ws esta registrado con .withSockJS(): el transporte crudo vive
// en /ws/<server>/<sesion>/websocket y los frames STOMP viajan envueltos en el
// protocolo SockJS. Mandar STOMP crudo contra /ws/websocket no funciona.
//
// CONSECUTIVO activa el control de huecos. T27 ya instrumenta las cabeceras
// emitidoEn, consecutivo e instancia en PushFanOutAdapter. El consecutivo es
// por instancia y destino: con dos nodos, un contador global daria huecos que
// no son perdidas.
//
// Los huecos se cuentan POR SUSCRIPTOR: cada VU de k6 tiene su propio estado y
// no comparte memoria con las demas. Es la unica medicion honesta posible con
// esta herramienta.
// ==========================================================================

import http from 'k6/http';
import ws from 'k6/ws';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';

// ---------------------------------------------------------------- metricas
const propagacionMs = new Trend('propagacion_ms', true);
const huecosDetectados = new Counter('huecos_detectados');
const eventosRecibidos = new Counter('eventos_recibidos');
const eventosSinMarca = new Counter('eventos_sin_marca');
const wsConectados = new Counter('ws_conectados');
const wsErrores = new Counter('ws_errores');

// ---------------------------------------------------------------- entorno
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const WS_BASE = __ENV.WS_BASE || 'ws://localhost:8080/ws';
const TOKEN = __ENV.TOKEN || '';
const SUSCRIPTORES = Number(__ENV.SUSCRIPTORES || 10);
const CON_CONSECUTIVO = __ENV.CONSECUTIVO === 'true';
// DURACION permite una corrida corta de humo. Por defecto, la meseta de ESC-7.
const DURACION = __ENV.DURACION || '15m';
const SUB_DURACION = __ENV.SUB_DURACION || DURACION;
// Peticiones por segundo de la meseta HTTP. Configurable porque el escenario de
// rendimiento fija la volumetria: dejarlo clavado en 8 obligaba a editar el
// script para demostrar los 100 req/s del enunciado.
const RATE = Number(__ENV.RATE || 8);
// Topicos a los que se suscribe cada cliente de prueba.
const DESTINOS = (__ENV.DESTINOS || '/topic/flota,/topic/emergencias,/topic/map.events')
  .split(',')
  .map((d) => d.trim())
  .filter(Boolean);

// Sin token no se puede abrir una suscripcion: mejor fallar al arrancar que
// correr 15 minutos recolectando errores.
if (SUSCRIPTORES > 0 && !TOKEN) {
  throw new Error('SUSCRIPTORES > 0 exige TOKEN: el CONNECT STOMP pide Authorization: Bearer <jwt>.');
}

// ---------------------------------------------------------------- umbrales
const umbrales = {
  http_req_duration: ['p(95)<500', 'p(99)<1000'],
  http_req_failed: ['rate<0.01'],
  checks: ['rate>0.99'],
};

// El umbral de huecos solo se exige cuando la instrumentacion existe.
if (CON_CONSECUTIVO) {
  umbrales.huecos_detectados = ['count==0'];
}

// Escenario de carga HTTP: la meseta que define ESC-7.
const escenarios = {
  lectura: {
    executor: 'constant-arrival-rate',
    exec: 'lectura',
    rate: RATE,
    timeUnit: '1s',
    duration: DURACION,
    preAllocatedVUs: 20,
    maxVUs: 80,
    tags: { escenario: 'lectura' },
  },
};

// Suscriptores STOMP: miden propagacion de punta a punta.
// Se omiten con SUSCRIPTORES=0 (corridas de humo). Siempre usan la meseta
// completa de 15 min; DURACION solo afecta la carga HTTP.
if (SUSCRIPTORES > 0) {
  escenarios.suscriptores = {
    executor: 'ramping-vus',
    exec: 'suscriptor',
    startVUs: 0,
    stages: [
      { duration: '30s', target: SUSCRIPTORES },
      { duration: SUB_DURACION, target: SUSCRIPTORES },
      { duration: '10s', target: 0 },
    ],
    tags: { escenario: 'suscriptores' },
  };
}

export const options = {
  scenarios: escenarios,
  thresholds: umbrales,
};

// ------------------------------------------------------------------- carga
// Reparto del trafico por tipo de pantalla: el mapa es lo que mas se consulta.
const RUTAS = [
  { path: '/api/v1/mapa', peso: 4 },
  { path: '/api/v1/flota/ambulancias', peso: 3 },
  { path: '/api/v1/emergencias', peso: 2 },
  { path: '/actuator/health', peso: 1 },
];

function elegirRuta() {
  const total = RUTAS.reduce((acc, r) => acc + r.peso, 0);
  let sorteo = Math.random() * total;
  for (const ruta of RUTAS) {
    sorteo -= ruta.peso;
    if (sorteo <= 0) return ruta;
  }
  return RUTAS[0];
}

export function lectura() {
  const ruta = elegirRuta();
  const headers = {};

  // /actuator/health es publico; el resto exige Bearer del IdP.
  if (ruta.path !== '/actuator/health' && TOKEN) {
    headers.Authorization = `Bearer ${TOKEN}`;
  }

  const res = http.get(`${BASE_URL}${ruta.path}`, {
    headers,
    tags: { endpoint: ruta.path },
  });

  check(res, {
    'status esperado': (r) => r.status === 200,
    'sin 5xx': (r) => r.status < 500,
  });
}

// -------------------------------------------------------------- STOMP
// El endpoint /ws esta registrado con .withSockJS(), asi que los frames STOMP
// viajan envueltos en el protocolo SockJS:
//   servidor -> "o" (abierto), "h" (latido), a["frame1","frame2"] (mensajes)
//   cliente  -> ["frame1","frame2"]
// Mandar STOMP crudo contra /ws/websocket no funciona: el servidor cierra.
function enviarSockJs(socket, frames) {
  socket.send(JSON.stringify(frames));
}

// La instrumentacion viaja en cabeceras STOMP (T27), no en el cuerpo:
//   emitidoEn    epoch ms de publicacion
//   consecutivo  creciente POR INSTANCIA Y DESTINO
//   instancia    nodo que publico
// El cuerpo sigue siendo el mismo payload de siempre, asi que el frontend no
// cambia. Los huecos se siguen por instancia+destino: un consecutivo global se
// intercalaria entre nodos y daria falsos positivos.
function procesarFrame(frame, ctx) {
  if (frame.startsWith('CONNECTED')) {
    if (!ctx.suscrito) {
      ctx.suscrito = true;
      DESTINOS.forEach((destino, i) => {
        enviarSockJs(ctx.socket, [`SUBSCRIBE\nid:sub-${i}\ndestination:${destino}\n\n\u0000`]);
      });
    }
    return;
  }

  if (!frame.startsWith('MESSAGE')) return;

  const corte = frame.indexOf('\n\n');
  if (corte < 0) return;

  // Cabeceras: una por linea, "clave:valor". La primera linea es MESSAGE.
  const cabeceras = {};
  for (const linea of frame.slice(0, corte).split('\n').slice(1)) {
    const separador = linea.indexOf(':');
    if (separador > 0) {
      cabeceras[linea.slice(0, separador)] = linea.slice(separador + 1);
    }
  }

  eventosRecibidos.add(1);

  const emision = Number(cabeceras.emitidoEn);
  if (emision > 0) {
    // Se recorta a cero: el reloj del host y el del contenedor no son el mismo,
    // y una diferencia de milisegundos daria una latencia negativa.
    propagacionMs.add(Math.max(0, Date.now() - emision));
  } else {
    eventosSinMarca.add(1);
  }

  const consecutivo = Number(cabeceras.consecutivo);
  if (CON_CONSECUTIVO && consecutivo > 0) {
    const clave = `${cabeceras.instancia || 'desconocida'}|${cabeceras.destination || 'desconocido'}`;
    const ultimo = ctx.consecutivos[clave];
    if (ultimo !== undefined && consecutivo > ultimo + 1) {
      huecosDetectados.add(consecutivo - ultimo - 1);
    }
    ctx.consecutivos[clave] = consecutivo;
  }
}

export function suscriptor() {
  // SockJS exige la ruta /<server>/<sesion>/websocket para el transporte crudo.
  const idSesion = `${__VU}${Math.random().toString(36).slice(2, 10)}`;
  const url = `${WS_BASE}/000/${idSesion}/websocket`;

  const res = ws.connect(url, {}, (socket) => {
    const ctx = { socket, consecutivos: {}, suscrito: false };

    socket.on('open', () => {
      wsConectados.add(1);
    });

    socket.on('message', (data) => {
      const t = String(data).trim();

      if (t === 'o') {
        // Abierto: recien ahora se puede mandar el CONNECT de STOMP.
        // El CONNECT exige Authorization: Bearer <jwt> como cabecera nativa;
        // sin ella el servidor responde ERROR y cierra con 1002.
        const connect = TOKEN
          ? `CONNECT\naccept-version:1.2\nheart-beat:0,0\nAuthorization:Bearer ${TOKEN}\n\n\u0000`
          : 'CONNECT\naccept-version:1.2\nheart-beat:0,0\n\n\u0000';
        enviarSockJs(socket, [connect]);
        return;
      }
      if (t === 'h') return; // latido del servidor
      if (t.startsWith('c')) {
        socket.close();
        return;
      }
      if (!t.startsWith('a')) return;

      let frames;
      try {
        frames = JSON.parse(t.slice(1));
      } catch (err) {
        return;
      }
      for (const frame of frames) procesarFrame(frame, ctx);
    });

    socket.on('error', () => {
      wsErrores.add(1);
    });

    // Mantener la conexion viva durante la meseta.
    socket.setTimeout(() => socket.close(), 15 * 60 * 1000);
  });

  check(res, { 'websocket abierto': (r) => r && r.status === 101 });
}
