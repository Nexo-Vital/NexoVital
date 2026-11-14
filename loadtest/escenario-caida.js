// ==========================================================================
// Escenario de caida de una instancia — NexoVital (Sprint 2, T07, escenario D-1)
//
//   Fuente:    100 usuarios conectados (WebSocket abierto todo el tiempo).
//   Estimulo:  cada usuario envia 1 peticion por segundo durante 5 minutos; en
//              el minuto 2 una de las dos instancias del backend falla
//              (la detiene loadtest/probar-caida.sh con `docker compose stop -t 0`,
//              es decir, un SIGKILL: sin apagado ordenado).
//   Medidas:   - al menos el 95 % de las peticiones termina bien (antes y
//                despues de la caida)
//              - los clientes que estaban en la instancia caida se reconectan
//                en menos de 10 s
//              - ninguna emergencia ni donacion confirmada se pierde: todo lo
//                que recibio 2xx esta en la base al final
//
// Reparto de los 100 usuarios:
//   - VU 1, 2   ciudadanos: reportan una emergencia cada 5 s (descripcion con
//               el id de la corrida) y leen el resto del tiempo.
//   - VU 3, 4   administrador de plataforma: dona 1 unidad cada 5 s a un insumo
//               con necesidad pendiente y lee el resto del tiempo.
//   - resto     leen el mapa, la flota y las emergencias 1/s.
//   Todos tienen su conexion STOMP; si se cae, esperan 2 s (como el front, T06)
//   y se vuelven a conectar a traves de nginx.
//
// Comprobacion de perdidas (teardown, con la instancia caida):
//   - emergencias: cuenta en GET /api/v1/emergencias las que llevan el id de la
//     corrida y lo compara con las respuestas 201 recibidas.
//   - donaciones: lee el disponible final del insumo y lo compara con el
//     inicial + las donaciones confirmadas (no hay despachos en esta prueba).
//   Si la base tiene MAS de lo confirmado no es perdida: es una peticion que se
//   aplico pero cuya respuesta se corto con la caida (se informa aparte).
//
// Uso: no se corre solo, lo lanza loadtest/probar-caida.sh (que provoca la
// caida en el momento justo). Para un ensayo sin caida:
//   k6 run -e DURACION=1m loadtest/escenario-caida.js
//
// Variables: BASE_URL, WS_BASE, USUARIOS (100), DURACION (5m), RAMPA_S (10),
//            CAIDA_S (120, segundos desde el inicio de la meseta),
//            RECONEXION_MS (2000), RESUMEN_JSON.
// Requiere el compose de pruebas con el limite T18 alto (ver
// docs/rendimiento-sprint2.md) y el mismo NEXOVITAL_JWT_SECRET en las dos
// instancias.
// ==========================================================================

import http from 'k6/http';
import { check, fail } from 'k6';
import { WebSocket } from 'k6/websockets';
import { setInterval, clearInterval, setTimeout } from 'k6/timers';
import { Counter, Gauge, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const WS_BASE = __ENV.WS_BASE || 'ws://localhost:8080/ws';
const USUARIOS = Number(__ENV.USUARIOS || 100);
const DURACION = __ENV.DURACION || '5m';
const RAMPA_MS = Number(__ENV.RAMPA_S || 10) * 1000;
const CAIDA_MS = Number(__ENV.CAIDA_S || 120) * 1000;
const RECONEXION_MS = Number(__ENV.RECONEXION_MS || 2000);
const LIMITE_RECONEXION_MS = 10000;
const EXITO_MINIMO = 0.95;
const UMBRAL_FALLOS = `rate<${(1 - EXITO_MINIMO).toFixed(2)}`;
const DESTINOS = ['/topic/flota', '/topic/suministros', '/topic/emergencias', '/topic/map.events'];

function aMilisegundos(texto) {
  const m = /^(\d+)(ms|s|m|h)$/.exec(String(texto).trim());
  if (!m) throw new Error(`DURACION invalida: ${texto}`);
  return Number(m[1]) * { ms: 1, s: 1000, m: 60000, h: 3600000 }[m[2]];
}
const DURACION_MS = aMilisegundos(DURACION);

const CIUDADANOS = [
  { email: 'ciudadano@nexovital.co', password: 'ciudadano123' },
  { email: 'ciudadano2@nexovital.co', password: 'ciudadano123' },
];
const ADMIN = { email: 'admin@nexovital.co', password: 'admin123' };
const LECTORES = [
  ...CIUDADANOS,
  { email: 'centro@nexovital.co', password: 'centro123' },
  { email: 'rangel@nexovital.co', password: 'rangel123' },
];

// ---------------------------------------------------------------- metricas
const clientesSuscritos = new Counter('clientes_suscritos');
const desconexiones = new Counter('desconexiones');
const reconexiones = new Counter('reconexiones');
const reconexionMs = new Trend('reconexion_ms', true);
const eventosRecibidos = new Counter('eventos_recibidos');
const respuestas5xx = new Counter('respuestas_5xx');
const emergenciasConfirmadas = new Counter('emergencias_confirmadas');
const donacionesConfirmadas = new Counter('donaciones_confirmadas');
// Gauge: el valor lo pone el teardown una sola vez (puede ser 0).
const emergenciasEnBase = new Gauge('emergencias_en_base');
const donacionesEnBase = new Gauge('donaciones_en_base');

export const options = {
  scenarios: {
    usuarios: {
      executor: 'per-vu-iterations',
      exec: 'usuario',
      vus: USUARIOS,
      iterations: 1,
      maxDuration: `${Math.ceil((RAMPA_MS + DURACION_MS) / 1000) + 120}s`,
    },
  },
  thresholds: {
    http_req_failed: [UMBRAL_FALLOS],
    // Se declaran para que el resumen traiga la tasa de cada fase.
    'http_req_failed{fase:antes}': [UMBRAL_FALLOS],
    'http_req_failed{fase:despues}': [UMBRAL_FALLOS],
    clientes_suscritos: [`count>=${USUARIOS}`],
  },
  setupTimeout: '60s',
  teardownTimeout: '60s',
  summaryTrendStats: ['avg', 'min', 'med', 'p(95)', 'max'],
};

// ------------------------------------------------------------------- setup
function iniciarSesion(cuenta) {
  const res = http.post(`${BASE_URL}/api/v1/sesiones`, JSON.stringify(cuenta), {
    headers: { 'Content-Type': 'application/json' },
    tags: { fase: 'preparacion' },
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

function leerInsumo(token, centroId, itemId) {
  const res = http.get(`${BASE_URL}/api/v1/centros-acopio/${centroId}/inventario`, {
    headers: cabeceras(token),
    tags: { fase: 'preparacion' },
  });
  if (res.status !== 200) return null;
  const cuerpo = res.json();
  const items = Array.isArray(cuerpo) ? cuerpo : (cuerpo && cuerpo.items) || [];
  return items.find((i) => i.id === itemId) || null;
}

export function setup() {
  const ciudadanos = CIUDADANOS.map(iniciarSesion);
  const admin = iniciarSesion(ADMIN);
  const lectores = LECTORES.map(iniciarSesion);

  // Un token emitido por una instancia debe valer en la otra.
  for (let i = 0; i < 8; i++) {
    const res = http.get(`${BASE_URL}/api/v1/mapa`, { headers: cabeceras(admin), tags: { fase: 'preparacion' } });
    if (res.status === 401) {
      fail('Una instancia rechazo un token de la otra (401). Define el MISMO NEXOVITAL_JWT_SECRET en el .env.');
    }
  }

  // Insumo con la mayor necesidad pendiente: recibe las donaciones.
  let donacion = null;
  const mapa = http.get(`${BASE_URL}/api/v1/mapa`, { headers: cabeceras(admin), tags: { fase: 'preparacion' } });
  const centros = mapa.status === 200 ? mapa.json('centros') || [] : [];
  for (const centro of centros.filter((c) => !c.tipo || c.tipo === 'CENTRO_ACOPIO')) {
    const inv = http.get(`${BASE_URL}/api/v1/centros-acopio/${centro.id}/inventario`, {
      headers: cabeceras(admin),
      tags: { fase: 'preparacion' },
    });
    if (inv.status !== 200) continue;
    const cuerpo = inv.json();
    const items = Array.isArray(cuerpo) ? cuerpo : (cuerpo && cuerpo.items) || [];
    for (const item of items) {
      const falta = item.requerido - item.disponible;
      if (falta > 0 && (!donacion || falta > donacion.falta)) {
        donacion = { centroId: centro.id, itemId: item.id, disponibleInicial: item.disponible, falta };
      }
    }
  }
  if (!donacion) fail('No hay un insumo con necesidad pendiente para las donaciones.');

  const corrida = `D1-${Date.now()}`;
  const inicioMeseta = Date.now() + RAMPA_MS;
  // probar-caida.sh lee esta linea para detener la instancia en el momento justo.
  console.log(`INICIO_MESETA=${inicioMeseta} CAIDA_EN=${inicioMeseta + CAIDA_MS} CORRIDA=${corrida}`);
  return { corrida, inicio: Date.now(), inicioMeseta, ciudadanos, admin, lectores, donacion };
}

// ------------------------------------------------------------------- carga
function fase(datos) {
  return Date.now() < datos.inicioMeseta + CAIDA_MS ? 'antes' : 'despues';
}

const ACEPTA_409 = http.expectedStatuses({ min: 200, max: 299 }, 409);
const RUTAS = ['/api/v1/mapa', '/api/v1/mapa', '/api/v1/flota/ambulancias', '/api/v1/emergencias'];
const fallosVistos = {};

function registrar(res, nombre, aceptados) {
  if (res.status >= 500 || res.status === 0) respuestas5xx.add(1, { endpoint: nombre });
  if (!aceptados.includes(res.status)) {
    const clave = `${nombre}|${res.status}`;
    if (!fallosVistos[clave]) {
      fallosVistos[clave] = true;
      console.warn(`Fallo HTTP ${res.status} en ${nombre} (VU ${__VU})`);
    }
  }
  check(res, { 'respuesta valida': (r) => aceptados.includes(r.status) });
}

function leer(datos, token) {
  const ruta = RUTAS[Math.floor(Math.random() * RUTAS.length)];
  const res = http.get(`${BASE_URL}${ruta}`, { headers: cabeceras(token), tags: { endpoint: ruta, fase: fase(datos) } });
  registrar(res, ruta, [200]);
}

function reportarEmergencia(datos, token, n) {
  const ruta = '/api/v1/emergencias';
  const cuerpo = {
    ubicacion: { lat: 4.70 + Math.random() * 0.05, lng: -74.10 + Math.random() * 0.05 },
    tipo: 'OTRO',
    nivel: 'BAJO',
    descripcion: `Prueba D-1 ${datos.corrida} VU${__VU}-${n}`,
    direccion: 'Prueba de caida de instancia',
  };
  const res = http.post(`${BASE_URL}${ruta}`, JSON.stringify(cuerpo), {
    headers: cabeceras(token),
    tags: { endpoint: ruta, fase: fase(datos) },
  });
  if (res.status === 201 || res.status === 200) emergenciasConfirmadas.add(1);
  registrar(res, ruta, [200, 201]);
}

function donar(datos) {
  const d = datos.donacion;
  const ruta = '/api/v1/centros-acopio/{id}/inventario/donacion';
  const res = http.post(
    `${BASE_URL}/api/v1/centros-acopio/${d.centroId}/inventario/donacion`,
    JSON.stringify({ itemId: d.itemId, cantidad: 1 }),
    { headers: cabeceras(datos.admin), tags: { endpoint: ruta, name: ruta, fase: fase(datos) }, responseCallback: ACEPTA_409 },
  );
  // 409 = necesidad ya cubierta: respuesta de negocio, no cambia el stock.
  if (res.status >= 200 && res.status < 300) donacionesConfirmadas.add(1);
  registrar(res, ruta, [200, 201, 409]);
}

// -------------------------------------------------------------- STOMP
// Abre una sesion STOMP sobre SockJS. alConectar se llama con el CONNECTED;
// alCerrar cuando el socket se cierra por cualquier motivo.
function abrirStomp(token, alConectar, alCerrar) {
  const idSesion = `${__VU}${Math.random().toString(36).slice(2, 10)}`;
  const socket = new WebSocket(`${WS_BASE}/000/${idSesion}/websocket`);
  let conectado = false;
  let terminado = false;
  // 'error' y 'close' pueden llegar los dos (o solo uno, si la conexion ni se
  // abre): se avisa una sola vez.
  const finalizar = () => {
    if (terminado) return;
    terminado = true;
    alCerrar(conectado);
  };

  socket.addEventListener('message', (evento) => {
    const t = String(evento.data).trim();
    if (t === 'o') {
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
    for (const frame of frames) {
      if (frame.startsWith('CONNECTED') && !conectado) {
        conectado = true;
        socket.send(JSON.stringify(
          DESTINOS.map((destino, i) => `SUBSCRIBE\nid:sub-${i}\ndestination:${destino}\n\n\u0000`),
        ));
        alConectar();
      } else if (frame.startsWith('MESSAGE')) {
        eventosRecibidos.add(1);
      }
    }
  });
  socket.addEventListener('error', finalizar);
  socket.addEventListener('close', finalizar);
  return socket;
}

// Mantiene al usuario conectado: si la sesion se cae, espera RECONEXION_MS y
// reintenta hasta lograrlo, y mide desde la caida hasta el nuevo CONNECTED.
function conexionPersistente(token, finMs) {
  const estado = { socket: null, terminando: false, caidaEn: null, primera: true };

  const conectar = () => {
    if (estado.terminando) return;
    estado.socket = abrirStomp(
      token,
      () => {
        if (estado.primera) {
          estado.primera = false;
          clientesSuscritos.add(1);
        } else if (estado.caidaEn !== null) {
          reconexiones.add(1);
          reconexionMs.add(Date.now() - estado.caidaEn);
        }
        estado.caidaEn = null;
      },
      (estabaConectado) => {
        if (estado.terminando || Date.now() >= finMs) return;
        // Solo la primera caida marca el inicio; los reintentos fallidos no
        // reinician el reloj.
        if (estabaConectado && estado.caidaEn === null) {
          estado.caidaEn = Date.now();
          desconexiones.add(1);
        }
        setTimeout(conectar, RECONEXION_MS);
      },
    );
  };

  conectar();
  return {
    cerrar() {
      estado.terminando = true;
      if (estado.socket) estado.socket.close();
    },
  };
}

// ---------------------------------------------------------------- usuario
export function usuario(datos) {
  const fin = datos.inicioMeseta + DURACION_MS;
  const espera = Math.max(0, datos.inicio + ((__VU - 1) / USUARIOS) * RAMPA_MS - Date.now());
  const escribeEmergencias = __VU <= 2;
  const dona = __VU === 3 || __VU === 4;
  const token = escribeEmergencias
    ? datos.ciudadanos[__VU - 1]
    : dona ? datos.admin : datos.lectores[(__VU - 1) % datos.lectores.length];

  setTimeout(() => {
    const conexion = conexionPersistente(token, fin);
    let paso = 0;
    let reloj = null;
    setTimeout(() => {
      reloj = setInterval(() => {
        if (Date.now() >= fin) {
          clearInterval(reloj);
          conexion.cerrar();
          return;
        }
        paso += 1;
        // Una peticion por segundo; los escritores escriben una de cada cinco.
        if (escribeEmergencias && paso % 5 === 0) reportarEmergencia(datos, token, paso);
        else if (dona && paso % 5 === 0) donar(datos);
        else leer(datos, token);
      }, 1000);
    }, Math.random() * 1000);
    setTimeout(() => conexion.cerrar(), Math.max(0, fin - Date.now()) + 3000);
  }, espera);
}

// ---------------------------------------------------------------- perdidas
export function teardown(datos) {
  const res = http.get(`${BASE_URL}/api/v1/emergencias`, {
    headers: cabeceras(datos.admin),
    tags: { fase: 'verificacion' },
  });
  if (res.status === 200) {
    const lista = res.json() || [];
    const propias = lista.filter((e) => e.descripcion && e.descripcion.indexOf(datos.corrida) >= 0);
    emergenciasEnBase.add(propias.length);
  } else {
    console.error(`No se pudo leer las emergencias para verificar (HTTP ${res.status})`);
  }
  const item = leerInsumo(datos.admin, datos.donacion.centroId, datos.donacion.itemId);
  if (item) {
    donacionesEnBase.add(item.disponible - datos.donacion.disponibleInicial);
  } else {
    console.error('No se pudo leer el inventario para verificar las donaciones');
  }
}

// ---------------------------------------------------------------- resumen
function valor(met, nombre, stat) {
  const m = met[nombre];
  return m && m.values ? m.values[stat] : undefined;
}
function pct(rate) {
  return rate === undefined ? 'sin datos' : `${((1 - rate) * 100).toFixed(2)} %`;
}
function seg(v) {
  return v === undefined ? 'sin datos' : `${(v / 1000).toFixed(2)} s`;
}

export function handleSummary(data) {
  const met = data.metrics;
  const fallidos = [];
  for (const [nombre, m] of Object.entries(met)) {
    for (const [expr, r] of Object.entries(m.thresholds || {})) {
      if (!r.ok) fallidos.push(`${nombre}: ${expr}`);
    }
  }

  const caidas = valor(met, 'desconexiones', 'count') || 0;
  const vueltas = valor(met, 'reconexiones', 'count') || 0;
  const maxReconexion = valor(met, 'reconexion_ms', 'max');
  if (caidas === 0) fallidos.push('ningun cliente perdio la conexion: ¿se detuvo la instancia?');
  if (vueltas < caidas) fallidos.push(`${caidas - vueltas} clientes no se reconectaron`);
  if (maxReconexion !== undefined && maxReconexion >= LIMITE_RECONEXION_MS) {
    fallidos.push(`reconexion maxima ${seg(maxReconexion)} (>= 10 s)`);
  }

  const emConf = valor(met, 'emergencias_confirmadas', 'count') || 0;
  const emBase = valor(met, 'emergencias_en_base', 'value');
  const doConf = valor(met, 'donaciones_confirmadas', 'count') || 0;
  const doBase = valor(met, 'donaciones_en_base', 'value');
  if (emBase === undefined) fallidos.push('no se pudo verificar las emergencias en la base');
  else if (emBase < emConf) fallidos.push(`${emConf - emBase} emergencias confirmadas no estan en la base`);
  if (doBase === undefined) fallidos.push('no se pudo verificar las donaciones en la base');
  else if (doBase < doConf) fallidos.push(`${doConf - doBase} donaciones confirmadas no estan en la base`);

  const lineas = [
    '',
    '===== NexoVital — escenario D-1 (caida de una instancia) =====',
    `Usuarios conectados al inicio:   ${valor(met, 'clientes_suscritos', 'count') || 0} de ${USUARIOS}`,
    `Duracion / caida:                ${DURACION} / en el segundo ${CAIDA_MS / 1000} de la meseta`,
    `Peticiones HTTP:                 ${valor(met, 'http_reqs', 'count') || 0} (${(valor(met, 'http_reqs', 'rate') || 0).toFixed(1)} req/s)`,
    `Exito HTTP total:                ${pct(valor(met, 'http_req_failed', 'rate'))}  (umbral >= 95 %)`,
    `  antes de la caida:             ${pct(valor(met, 'http_req_failed{fase:antes}', 'rate'))}`,
    `  despues de la caida:           ${pct(valor(met, 'http_req_failed{fase:despues}', 'rate'))}`,
    `Respuestas 5xx o sin respuesta:  ${valor(met, 'respuestas_5xx', 'count') || 0}  (informativo)`,
    '',
    `Clientes desconectados:          ${caidas}`,
    `Clientes reconectados:           ${vueltas}`,
    `Reconexion p95 / maxima:         ${seg(valor(met, 'reconexion_ms', 'p(95)'))} / ${seg(maxReconexion)}  (umbral < 10 s)`,
    `Eventos de tiempo real recibidos: ${valor(met, 'eventos_recibidos', 'count') || 0}`,
    '',
    `Emergencias confirmadas (201):   ${emConf}`,
    `Emergencias en la base:          ${emBase === undefined ? 'sin datos' : emBase}  (umbral: todas las confirmadas)`,
    `Donaciones confirmadas (2xx):    ${doConf}`,
    `Donaciones en la base (stock):   ${doBase === undefined ? 'sin datos' : doBase}  (umbral: todas las confirmadas)`,
  ];
  if (emBase > emConf || doBase > doConf) {
    lineas.push('  (en la base hay mas de lo confirmado: peticiones aplicadas cuya respuesta se corto con la caida; no es perdida)');
  }
  lineas.push('', fallidos.length === 0 ? 'RESULTADO: CUMPLE' : 'RESULTADO: NO CUMPLE', ...fallidos.map((f) => `  - ${f}`), '');

  const salida = { stdout: lineas.join('\n') };
  if (__ENV.RESUMEN_JSON) {
    salida[__ENV.RESUMEN_JSON] = JSON.stringify({
      escenario: 'D-1', usuarios: USUARIOS, duracion: DURACION, caidaS: CAIDA_MS / 1000,
      cumple: fallidos.length === 0, incumplimientos: fallidos, metricas: met,
    }, null, 2);
  }
  return salida;
}
