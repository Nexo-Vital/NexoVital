// ==========================================================================
// Escenario de rendimiento — NexoVital (Sprint 2, EP-06.F4.US1, T26/T28)
//
// Perfil por defecto: escenario R-1 del documento de escenarios de calidad.
//
//   Fuente:    200 usuarios conectados al mapa (ciudadanos, conductores y
//              administradores de centros), los 200 con su WebSocket abierto
//              durante toda la prueba.
//   Estimulo:  cada usuario envia 1 peticion por segundo durante 10 minutos
//              (unas 120.000 peticiones). Las de los conductores y la del
//              administrador de plataforma GENERAN eventos de tiempo real: el
//              movimiento de una ambulancia (/topic/flota) y el cambio del
//              semaforo de un centro (/topic/suministros).
//   Medidas:   - p95 de la latencia de los eventos <= 500 ms
//              - ningun evento se pierde (0 huecos en el consecutivo; un evento
//                que llega desordenado pero llega NO es una perdida, ver abajo)
//              - tasa de errores HTTP < 1 % (y 0 respuestas 5xx)
//              - la latencia del ultimo minuto no es peor que la del primero
//
// Reparto de los 200 usuarios (los eventos nacen de escrituras y la base solo
// tiene 5 ambulancias):
//   - VU 1..5  conductores: reportan la posicion de su propia unidad 1/s
//              (POST /flota/ambulancias/{id}/posicion).
//   - VU 6     administrador de plataforma: alterna despacho y donacion de 1
//              unidad sobre un insumo de un centro de acopio semilla (cambia
//              el semaforo). Los centros demo no tienen administrador propio.
//   - resto    ciudadanos y administradores de centros: consultan el mapa,
//              la flota y las emergencias 1/s y reciben todos los eventos.
//
// Requisitos:
//   - Levantar con el compose de pruebas (login local encendido) y el limite
//     T18 alto, porque el usuario de inventario dona 30 veces por minuto:
//       PRUEBA_LIMITE_USUARIO=100000 PRUEBA_LIMITE_IP=100000 \
//         docker compose -f docker-compose.yml -f docker-compose.pruebas.yml up -d --build
//   - Base con los datos semilla (cuentas demo, 5 ambulancias, centros).
//   - El MISMO NEXOVITAL_JWT_SECRET en todas las instancias (en el .env). Con el
//     secreto vacio cada instancia genera uno propio y rechaza los tokens de la
//     otra (401 al azar): el script lo detecta al arrancar y aborta.
//
// Uso (el script inicia sesion solo, no hace falta sacar un token):
//   k6 run loadtest/escenario-rendimiento.js                  # R-1 completo
//   k6 run -e USUARIOS=20 -e DURACION=1m loadtest/escenario-rendimiento.js   # humo
//   k6 run -e PERFIL=esc7 loadtest/escenario-rendimiento.js   # perfil ESC-7 anterior
//
// Variables de entorno:
//   BASE_URL     http://localhost:8080   base HTTP (nginx)
//   WS_BASE      ws://localhost:8080/ws  base STOMP (SockJS)
//   PERFIL       r1                      r1 | esc7
//   USUARIOS     200 (r1) / 10 (esc7)    clientes conectados
//   DURACION     10m (r1) / 15m (esc7)   meseta de la prueba
//   RAMPA_S      20                      segundos para conectar a todos
//   RATE         8                       solo esc7: peticiones HTTP por segundo
//   GRACIA_MS    3000                    un consecutivo que falta se da por perdido si
//                                        no llega en este tiempo (ver abajo)
//   TOLERANCIA   0.10                    ultimo minuto vs primero (ver abajo)
//   MARGEN_MS    20                      ultimo minuto vs primero (ver abajo)
//   RESUMEN_JSON (vacio)                 ruta para guardar el resumen en JSON
//
// "No peor" (ultimo minuto vs primero): con latencias de pocos milisegundos
// cualquier ruido haria "peor" al ultimo minuto. Se considera que NO empeora si
//   p95(ultimo) <= max(p95(primero) * (1 + TOLERANCIA), p95(primero) + MARGEN_MS)
// es decir, un 10 % o 20 ms de margen, lo que sea mayor.
//
// Perdida vs desorden: el consecutivo se asigna al publicar y dos hilos pueden
// publicar en orden distinto al que numeraron, asi que el cliente puede ver el
// 6 antes que el 5. Eso es DESORDEN (metrica eventos_desordenados), no perdida.
// Un consecutivo que falta solo cuenta como hueco si no llega dentro de
// GRACIA_MS; los que siguen pendientes al cerrar y son mas recientes que la
// gracia (eventos en vuelo) no se cuentan.
//
// El endpoint /ws esta registrado con .withSockJS(): el transporte crudo vive
// en /ws/<server>/<sesion>/websocket y los frames STOMP viajan envueltos en el
// protocolo SockJS. Mandar STOMP crudo contra /ws/websocket no funciona.
//
// La instrumentacion viaja en cabeceras STOMP (T27): emitidoEn (epoch ms de
// publicacion), consecutivo (creciente POR INSTANCIA Y DESTINO) e instancia.
// Los huecos se siguen por suscriptor y por instancia+destino: un consecutivo
// global se intercalaria entre nodos y daria huecos que no son perdidas.
// ==========================================================================

import http from 'k6/http';
import { check, fail } from 'k6';
import { WebSocket } from 'k6/websockets';
import { setInterval, clearInterval, setTimeout } from 'k6/timers';
import { Counter, Trend } from 'k6/metrics';

// ---------------------------------------------------------------- entorno
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const WS_BASE = __ENV.WS_BASE || 'ws://localhost:8080/ws';
const PERFIL = (__ENV.PERFIL || 'r1').toLowerCase();
const ES_R1 = PERFIL !== 'esc7';
const USUARIOS = Number(__ENV.USUARIOS || (ES_R1 ? 200 : 10));
const DURACION = __ENV.DURACION || (ES_R1 ? '10m' : '15m');
const RAMPA_MS = Number(__ENV.RAMPA_S || 20) * 1000;
const RATE = Number(__ENV.RATE || 8);
const TOLERANCIA = Number(__ENV.TOLERANCIA || 0.1);
const MARGEN_MS = Number(__ENV.MARGEN_MS || 20);
const GRACIA_MS = Number(__ENV.GRACIA_MS || 3000);
const DESTINOS = (__ENV.DESTINOS || '/topic/flota,/topic/suministros,/topic/emergencias,/topic/map.events')
  .split(',')
  .map((d) => d.trim())
  .filter(Boolean);

function aMilisegundos(texto) {
  const m = /^(\d+)(ms|s|m|h)$/.exec(String(texto).trim());
  if (!m) throw new Error(`DURACION invalida: ${texto} (usa 30s, 10m, 1h)`);
  const factor = { ms: 1, s: 1000, m: 60000, h: 3600000 }[m[2]];
  return Number(m[1]) * factor;
}

const DURACION_MS = aMilisegundos(DURACION);
const MINUTOS = Math.max(1, Math.ceil(DURACION_MS / 60000));

// Cuentas semilla (DataSeeder). Son credenciales de demo publicas.
const CONDUCTORES = [1, 2, 3, 4, 5].map((n) => ({
  email: `conductor${n}@nexovital.co`,
  password: 'conductor123',
}));
const ADMIN = { email: 'admin@nexovital.co', password: 'admin123' };
// Ciudadanos y administradores de centros: los que consultan el mapa.
const LECTORES = [
  { email: 'ciudadano@nexovital.co', password: 'ciudadano123' },
  { email: 'ciudadano2@nexovital.co', password: 'ciudadano123' },
  { email: 'centro@nexovital.co', password: 'centro123' },
  { email: 'rangel@nexovital.co', password: 'rangel123' },
];

// ---------------------------------------------------------------- metricas
const propagacionMs = new Trend('propagacion_ms', true);
const huecosDetectados = new Counter('huecos_detectados');
const eventosDesordenados = new Counter('eventos_desordenados');
const eventosRecibidos = new Counter('eventos_recibidos');
const eventosSinMarca = new Counter('eventos_sin_marca');
const clientesSuscritos = new Counter('clientes_suscritos');
const wsErrores = new Counter('ws_errores');
const respuestas5xx = new Counter('respuestas_5xx');

// ---------------------------------------------------------------- umbrales
const umbrales = {
  propagacion_ms: ['p(95)<=500'],
  // Se declaran para que el resumen traiga el p95 del primer y del ultimo
  // minuto; la comparacion entre ambos la hace handleSummary.
  'propagacion_ms{minuto:1}': ['p(95)<=500'],
  [`propagacion_ms{minuto:${MINUTOS}}`]: ['p(95)<=500'],
  huecos_detectados: ['count==0'],
  eventos_recibidos: ['count>0'],
  clientes_suscritos: [`count>=${USUARIOS}`],
  http_req_failed: ['rate<0.01'],
  respuestas_5xx: ['count==0'],
  http_req_duration: ['p(95)<500', 'p(99)<1000'],
};

// Todos los usuarios corren a la vez una sola iteracion larga: se conectan
// escalonados durante la rampa y se quedan hasta el final de la meseta.
const escenarios = {
  usuarios: {
    executor: 'per-vu-iterations',
    exec: 'usuario',
    vus: USUARIOS,
    iterations: 1,
    maxDuration: `${Math.ceil((RAMPA_MS + DURACION_MS) / 1000) + 120}s`,
  },
};

// ESC-7: la carga HTTP es una tasa global aparte; los usuarios solo escuchan.
if (!ES_R1) {
  escenarios.lectura = {
    executor: 'constant-arrival-rate',
    exec: 'lecturaEsc7',
    rate: RATE,
    timeUnit: '1s',
    duration: DURACION,
    startTime: `${Math.ceil(RAMPA_MS / 1000)}s`,
    preAllocatedVUs: 20,
    maxVUs: 80,
  };
}

export const options = {
  scenarios: escenarios,
  thresholds: umbrales,
  setupTimeout: '60s',
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

// ------------------------------------------------------------------- setup
function iniciarSesion(cuenta) {
  const res = http.post(`${BASE_URL}/api/v1/sesiones`, JSON.stringify(cuenta), {
    headers: { 'Content-Type': 'application/json' },
    tags: { endpoint: '/api/v1/sesiones' },
  });
  if (res.status !== 200) {
    fail(`No se pudo iniciar sesion con ${cuenta.email} (HTTP ${res.status}). ` +
      '¿Levantaste con docker-compose.pruebas.yml (login local encendido)?');
  }
  return res.json('token');
}

function cabeceras(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// Un token firmado por una instancia debe valer en todas. Se pide varias veces
// para que el round-robin de nginx pase por cada instancia: con secretos JWT
// distintos (NEXOVITAL_JWT_SECRET vacio) alguna respuesta sera 401.
function verificarToken(token) {
  for (let i = 0; i < 8; i++) {
    const res = http.get(`${BASE_URL}/api/v1/mapa`, { headers: cabeceras(token) });
    if (res.status === 401) {
      fail('Una instancia rechazo un token emitido por otra (401). Define el MISMO ' +
        'NEXOVITAL_JWT_SECRET para todas las instancias (en el .env) y vuelve a levantar.');
    }
  }
}

export function setup() {
  const conductores = [];
  if (ES_R1) {
    for (const cuenta of CONDUCTORES) {
      const token = iniciarSesion(cuenta);
      const res = http.get(`${BASE_URL}/api/v1/flota/ambulancias/mia`, { headers: cabeceras(token) });
      const unidad = res.status === 200 && res.body ? res.json() : null;
      if (!unidad || !unidad.id) {
        console.warn(`${cuenta.email} no tiene ambulancia asignada: se usa como lector.`);
        continue;
      }
      const base = unidad.ubicacion || { lat: 4.735, lng: -74.08 };
      conductores.push({ token, ambulanciaId: unidad.id, lat: base.lat, lng: base.lng });
    }
  }

  let inventario = null;
  if (ES_R1) {
    const token = iniciarSesion(ADMIN);
    const mapa = http.get(`${BASE_URL}/api/v1/mapa`, { headers: cabeceras(token) });
    const centros = mapa.status === 200 ? mapa.json('centros') || [] : [];
    for (const centro of centros.filter((c) => !c.tipo || c.tipo === 'CENTRO_ACOPIO')) {
      const inv = http.get(`${BASE_URL}/api/v1/centros-acopio/${centro.id}/inventario`, {
        headers: cabeceras(token),
      });
      if (inv.status !== 200) continue;
      const cuerpo = inv.json();
      const items = Array.isArray(cuerpo) ? cuerpo : (cuerpo && cuerpo.items) || [];
      // Con stock para despachar y necesidad pendiente, para que la donacion
      // tambien se acepte tras el despacho.
      const item = items.find((i) => i.disponible >= 1 && i.requerido > i.disponible);
      if (item) {
        inventario = { token, centroId: centro.id, itemId: item.id };
        break;
      }
    }
    if (!inventario) {
      console.warn('No hay un insumo con stock y necesidad pendiente: no habra eventos de semaforo.');
    }
  }

  const lectores = LECTORES.map(iniciarSesion);
  // Instante comun de referencia: la meseta empieza al terminar la rampa.
  const todos = [...conductores.map((c) => c.token), ...(inventario ? [inventario.token] : []), ...lectores];
  todos.forEach(verificarToken);
  return { inicio: Date.now(), conductores, inventario, lectores };
}

// ------------------------------------------------------------------- carga
const RUTAS = [
  { path: '/api/v1/mapa', peso: 4 },
  { path: '/api/v1/flota/ambulancias', peso: 3 },
  { path: '/api/v1/emergencias', peso: 2 },
  { path: '/actuator/health', peso: 1 },
];
const PESO_TOTAL = RUTAS.reduce((acc, r) => acc + r.peso, 0);

function elegirRuta() {
  let sorteo = Math.random() * PESO_TOTAL;
  for (const ruta of RUTAS) {
    sorteo -= ruta.peso;
    if (sorteo <= 0) return ruta;
  }
  return RUTAS[0];
}

const fallosVistos = {};

function registrar(res, nombre, aceptados) {
  if (res.status >= 500) respuestas5xx.add(1, { endpoint: nombre });
  if (!aceptados.includes(res.status)) {
    // Un aviso por usuario, endpoint y codigo: suficiente para diagnosticar.
    const clave = `${nombre}|${res.status}`;
    if (!fallosVistos[clave]) {
      fallosVistos[clave] = true;
      console.warn(`Fallo HTTP ${res.status} en ${nombre} (VU ${__VU})`);
    }
  }
  check(res, {
    'status esperado': (r) => aceptados.includes(r.status),
    'sin 5xx': (r) => r.status < 500,
  });
}

function leer(token) {
  const ruta = elegirRuta();
  const headers = ruta.path === '/actuator/health' ? {} : { Authorization: `Bearer ${token}` };
  const res = http.get(`${BASE_URL}${ruta.path}`, { headers, tags: { endpoint: ruta.path } });
  registrar(res, ruta.path, [200]);
}

function moverAmbulancia(conductor, paso) {
  // Recorre un circulo de ~300 m alrededor de su posicion inicial.
  const angulo = (paso % 360) * (Math.PI / 30);
  const cuerpo = {
    ubicacion: {
      lat: conductor.lat + 0.003 * Math.sin(angulo),
      lng: conductor.lng + 0.003 * Math.cos(angulo),
    },
    heading: Math.round(((angulo * 180) / Math.PI) % 360),
  };
  const ruta = '/api/v1/flota/ambulancias/{id}/posicion';
  const res = http.post(
    `${BASE_URL}/api/v1/flota/ambulancias/${conductor.ambulanciaId}/posicion`,
    JSON.stringify(cuerpo),
    { headers: cabeceras(conductor.token), tags: { endpoint: ruta, name: ruta } },
  );
  registrar(res, ruta, [200]);
}

// Despacho y donacion de 1 unidad, alternados: el stock oscila y el semaforo
// se recalcula y se publica en cada peticion. 409 es una respuesta de negocio
// valida (sin stock / necesidad cubierta), no un error del servicio.
const ACEPTA_409 = http.expectedStatuses({ min: 200, max: 299 }, 409);

function moverInventario(inventario, paso) {
  const despacho = paso % 2 === 0;
  const accion = despacho ? 'despacho' : 'donacion';
  const ruta = `/api/v1/centros-acopio/{id}/inventario/${accion}`;
  const cuerpo = despacho
    ? { itemId: inventario.itemId, cantidad: 1, motivo: 'Prueba de carga R-1' }
    : { itemId: inventario.itemId, cantidad: 1 };
  const res = http.post(
    `${BASE_URL}/api/v1/centros-acopio/${inventario.centroId}/inventario/${accion}`,
    JSON.stringify(cuerpo),
    { headers: cabeceras(inventario.token), tags: { endpoint: ruta, name: ruta }, responseCallback: ACEPTA_409 },
  );
  registrar(res, ruta, [200, 409]);
}

// -------------------------------------------------------------- STOMP
function etiquetaMinuto(inicioMeseta) {
  const transcurrido = Date.now() - inicioMeseta;
  if (transcurrido < 0) return 'rampa';
  return String(Math.min(MINUTOS, Math.floor(transcurrido / 60000) + 1));
}

function procesarFrame(frame, ctx) {
  if (frame.startsWith('CONNECTED')) {
    if (!ctx.suscrito) {
      ctx.suscrito = true;
      clientesSuscritos.add(1);
      const frames = DESTINOS.map((destino, i) => `SUBSCRIBE\nid:sub-${i}\ndestination:${destino}\n\n\u0000`);
      ctx.socket.send(JSON.stringify(frames));
    }
    return;
  }
  if (frame.startsWith('ERROR')) {
    wsErrores.add(1);
    return;
  }
  if (!frame.startsWith('MESSAGE')) return;

  const corte = frame.indexOf('\n\n');
  if (corte < 0) return;
  const cab = {};
  for (const linea of frame.slice(0, corte).split('\n').slice(1)) {
    const sep = linea.indexOf(':');
    if (sep > 0) cab[linea.slice(0, sep)] = linea.slice(sep + 1);
  }

  eventosRecibidos.add(1);
  const emision = Number(cab.emitidoEn);
  if (emision > 0) {
    // Recorte a cero: el reloj del host y el del contenedor no son el mismo.
    propagacionMs.add(Math.max(0, Date.now() - emision), {
      minuto: etiquetaMinuto(ctx.inicioMeseta),
      destino: cab.destination || 'desconocido',
    });
  } else {
    eventosSinMarca.add(1);
  }

  const consecutivo = Number(cab.consecutivo);
  if (consecutivo > 0) {
    const destino = cab.destination || 'desconocido';
    const clave = `${cab.instancia || 'desconocida'}|${destino}`;
    const ahora = Date.now();
    const seguimiento = ctx.consecutivos[clave];
    if (!seguimiento) {
      // Primer evento visto de esa instancia y destino: punto de partida.
      ctx.consecutivos[clave] = { maximo: consecutivo, pendientes: new Map(), destino };
    } else if (consecutivo > seguimiento.maximo) {
      // Salto hacia delante: los que faltan quedan pendientes hasta que lleguen.
      for (let n = seguimiento.maximo + 1; n < consecutivo && seguimiento.pendientes.size < 100000; n++) {
        seguimiento.pendientes.set(n, ahora);
      }
      seguimiento.maximo = consecutivo;
    } else if (seguimiento.pendientes.delete(consecutivo)) {
      // Llego tarde, pero llego: desorden, no perdida.
      eventosDesordenados.add(1, { destino });
    }
    if (seguimiento) vencerPendientes(seguimiento, ahora);
  }
}

// Los pendientes que superan la gracia se dan por perdidos.
function vencerPendientes(seguimiento, ahora) {
  for (const [numero, desde] of seguimiento.pendientes) {
    if (ahora - desde > GRACIA_MS) {
      seguimiento.pendientes.delete(numero);
      huecosDetectados.add(1, { destino: seguimiento.destino });
    }
  }
}

function cerrarCuenta(ctx) {
  const ahora = Date.now();
  for (const seguimiento of Object.values(ctx.consecutivos)) vencerPendientes(seguimiento, ahora);
}

function abrirStomp(token, inicioMeseta, alCerrar) {
  const idSesion = `${__VU}${Math.random().toString(36).slice(2, 10)}`;
  const socket = new WebSocket(`${WS_BASE}/000/${idSesion}/websocket`);
  const ctx = { socket, consecutivos: {}, suscrito: false, inicioMeseta };

  socket.addEventListener('message', (evento) => {
    const t = String(evento.data).trim();
    if (t === 'o') {
      // El CONNECT exige Authorization: Bearer <jwt> o el servidor cierra con 1002.
      socket.send(JSON.stringify([
        `CONNECT\naccept-version:1.2\nheart-beat:0,0\nAuthorization:Bearer ${token}\n\n\u0000`,
      ]));
      return;
    }
    if (t === 'h') return;
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
  socket.addEventListener('error', () => wsErrores.add(1));
  socket.addEventListener('close', () => {
    cerrarCuenta(ctx);
    alCerrar();
  });
  return socket;
}

// ---------------------------------------------------------------- usuario
function rolDe(vu, datos) {
  if (!ES_R1) return { tipo: 'oyente', token: datos.lectores[(vu - 1) % datos.lectores.length] };
  if (vu <= datos.conductores.length) {
    const c = datos.conductores[vu - 1];
    return { tipo: 'conductor', token: c.token, conductor: c };
  }
  if (datos.inventario && vu === datos.conductores.length + 1) {
    return { tipo: 'inventario', token: datos.inventario.token, inventario: datos.inventario };
  }
  return { tipo: 'lector', token: datos.lectores[(vu - 1) % datos.lectores.length] };
}

export function usuario(datos) {
  const rol = rolDe(__VU, datos);
  const inicioMeseta = datos.inicio + RAMPA_MS;
  const fin = inicioMeseta + DURACION_MS;
  // Escalona las conexiones durante la rampa para no abrir 200 de golpe.
  const espera = Math.max(0, datos.inicio + ((__VU - 1) / USUARIOS) * RAMPA_MS - Date.now());

  setTimeout(() => {
    let reloj = null;
    const socket = abrirStomp(rol.token, inicioMeseta, () => {
      if (reloj !== null) clearInterval(reloj);
    });

    let paso = 0;
    // Desfase aleatorio dentro del segundo: que los 200 no disparen a la vez.
    setTimeout(() => {
      reloj = setInterval(() => {
        if (Date.now() >= fin) {
          clearInterval(reloj);
          reloj = null;
          socket.close();
          return;
        }
        paso += 1;
        if (rol.tipo === 'conductor') moverAmbulancia(rol.conductor, paso);
        else if (rol.tipo === 'inventario') moverInventario(rol.inventario, paso);
        else if (rol.tipo === 'lector') leer(rol.token);
        // 'oyente' (ESC-7) solo escucha: su carga HTTP va por otro escenario.
      }, 1000);
    }, Math.random() * 1000);

    // Red de seguridad: cerrar aunque el intervalo se haya detenido antes.
    setTimeout(() => socket.close(), Math.max(0, fin - Date.now()) + 2000);
  }, espera);
}

export function lecturaEsc7(datos) {
  leer(datos.lectores[Math.floor(Math.random() * datos.lectores.length)]);
}

// ---------------------------------------------------------------- resumen
function valor(metricas, nombre, stat) {
  const m = metricas[nombre];
  return m && m.values ? m.values[stat] : undefined;
}

function ms(v) {
  return v === undefined ? 'sin datos' : `${v.toFixed(1)} ms`;
}

function umbralesOk(metricas) {
  const fallidos = [];
  for (const [nombre, m] of Object.entries(metricas)) {
    for (const [expr, r] of Object.entries(m.thresholds || {})) {
      if (!r.ok) fallidos.push(`${nombre}: ${expr}`);
    }
  }
  return fallidos;
}

export function handleSummary(data) {
  const met = data.metrics;
  const p95Total = valor(met, 'propagacion_ms', 'p(95)');
  const p95Primero = valor(met, 'propagacion_ms{minuto:1}', 'p(95)');
  const p95Ultimo = valor(met, `propagacion_ms{minuto:${MINUTOS}}`, 'p(95)');
  const limite = p95Primero === undefined
    ? undefined
    : Math.max(p95Primero * (1 + TOLERANCIA), p95Primero + MARGEN_MS);
  const noPeor = limite !== undefined && p95Ultimo !== undefined && p95Ultimo <= limite;

  const fallidos = umbralesOk(met);
  if (!noPeor) fallidos.push(`ultimo minuto peor que el primero (${ms(p95Ultimo)} > ${ms(limite)})`);

  const peticiones = valor(met, 'http_reqs', 'count') || 0;
  const errores = valor(met, 'http_req_failed', 'rate');
  const lineas = [
    '',
    `===== NexoVital — escenario ${ES_R1 ? 'R-1' : 'ESC-7'} =====`,
    `Usuarios conectados (suscritos): ${valor(met, 'clientes_suscritos', 'count') || 0} de ${USUARIOS}`,
    `Duracion de la meseta:           ${DURACION}`,
    `Peticiones HTTP:                 ${peticiones} (${(valor(met, 'http_reqs', 'rate') || 0).toFixed(1)} req/s)`,
    `Tasa de errores HTTP:            ${errores === undefined ? 'sin datos' : `${(errores * 100).toFixed(3)} %`}  (umbral < 1 %)`,
    `Respuestas 5xx:                  ${valor(met, 'respuestas_5xx', 'count') || 0}  (umbral 0)`,
    `HTTP p95 / p99:                  ${ms(valor(met, 'http_req_duration', 'p(95)'))} / ${ms(valor(met, 'http_req_duration', 'p(99)'))}`,
    '',
    `Eventos recibidos:               ${valor(met, 'eventos_recibidos', 'count') || 0}`,
    `Eventos sin marca de tiempo:     ${valor(met, 'eventos_sin_marca', 'count') || 0}`,
    `Eventos perdidos (huecos):       ${valor(met, 'huecos_detectados', 'count') || 0}  (umbral 0)`,
    `Eventos desordenados (llegaron): ${valor(met, 'eventos_desordenados', 'count') || 0}  (informativo)`,
    `Latencia de eventos p95:         ${ms(p95Total)}  (umbral <= 500 ms)`,
    `  p95 primer minuto:             ${ms(p95Primero)}`,
    `  p95 ultimo minuto (${MINUTOS}):       ${ms(p95Ultimo)}  (no peor si <= ${ms(limite)})`,
    `Errores de WebSocket:            ${valor(met, 'ws_errores', 'count') || 0}`,
    '',
    fallidos.length === 0 ? 'RESULTADO: CUMPLE' : 'RESULTADO: NO CUMPLE',
    ...fallidos.map((f) => `  - ${f}`),
    '',
  ];

  const salida = { stdout: lineas.join('\n') };
  if (__ENV.RESUMEN_JSON) {
    salida[__ENV.RESUMEN_JSON] = JSON.stringify({
      escenario: ES_R1 ? 'R-1' : 'ESC-7',
      usuarios: USUARIOS,
      duracion: DURACION,
      p95PrimerMinutoMs: p95Primero,
      p95UltimoMinutoMs: p95Ultimo,
      ultimoMinutoNoPeor: noPeor,
      cumple: fallidos.length === 0,
      incumplimientos: fallidos,
      metricas: met,
    }, null, 2);
  }
  return salida;
}
