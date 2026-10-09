/**
 * Evidencia EN VIVO de los retos de tiempo real de NexoVital contra un despliegue
 * real (la nube o el backend local). No usa mocks: abre conexiones STOMP reales.
 *
 * Que comprueba:
 *   RT2  Seguimiento de la flota: N clientes conectados a la vez reciben las
 *        posiciones de /topic/flota, todos con la misma cadencia.
 *   RT1  Elementos del mapa: se reporta una emergencia y se mide cuanto tarda
 *        en llegar a CADA uno de los N clientes por /topic/emergencias
 *        (latencia de propagacion, p50 / p95 / max contra el umbral de 3 s).
 *   REC  Reconexion: se corta en seco la conexion de un cliente; debe volver
 *        solo, y lo que paso mientras estaba caido se recupera por REST
 *        (GET /api/v1/emergencias), porque el push no se repite.
 *
 * Limpieza: cada emergencia creada se cierra (estado CERRADA) al final.
 *
 * Uso (desde Front_NexoVital, con las dependencias instaladas):
 *   node scripts/prueba-tiempo-real.mjs --base https://<FRONT_FQDN>
 *   node scripts/prueba-tiempo-real.mjs --base http://localhost:8080 --clientes 5
 *
 * Opciones: --clientes 10  --rondas 5  --ventana 20 (segundos para RT2)
 *           --umbral 3000 (ms, criterio de la HU de propagacion de alertas)
 * Codigo de salida: 0 si todo paso, 1 si algo fallo.
 */
import { Client } from '@stomp/stompjs';
import WebSocket from 'ws';

// ---------------------------------------------------------------- parametros
function leerArgs(argv) {
  const opciones = {
    base: 'http://localhost:8080',
    clientes: 10,
    rondas: 5,
    ventana: 20,
    umbral: 3000,
    ciudadano: 'ciudadano@nexovital.co',
    ciudadanoPassword: 'ciudadano123',
    cierre: 'rangel@nexovital.co',
    cierrePassword: 'rangel123',
  };
  for (let i = 0; i < argv.length; i += 2) {
    const clave = argv[i]?.replace(/^--/, '');
    const valor = argv[i + 1];
    if (!clave || valor === undefined || !(clave in opciones)) {
      console.error(`Opcion desconocida o sin valor: ${argv[i]}`);
      process.exit(2);
    }
    opciones[clave] = typeof opciones[clave] === 'number' ? Number(valor) : valor;
  }
  opciones.base = opciones.base.replace(/\/+$/, '');
  return opciones;
}

const opt = leerArgs(process.argv.slice(2));
const API = `${opt.base}/api/v1`;
// SockJS expone el WebSocket "crudo" en /ws/websocket (sin el protocolo SockJS).
const WS_URL = `${opt.base.replace(/^http/, 'ws')}/ws/websocket`;
const TIMEOUT_EVENTO_MS = 15000;

let fallos = 0;
function paso(nombre, ok, detalle = '') {
  console.log(`${ok ? '[ OK ]' : '[FALLA]'} ${nombre}`);
  if (detalle) console.log(`       ${detalle}`);
  if (!ok) fallos++;
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- REST
async function api(metodo, ruta, token, cuerpo) {
  const respuesta = await fetch(`${API}${ruta}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(90000),
  });
  const texto = await respuesta.text();
  const datos = texto ? JSON.parse(texto) : null;
  if (!respuesta.ok) {
    throw new Error(`${metodo} ${ruta} -> HTTP ${respuesta.status} ${texto.slice(0, 200)}`);
  }
  return datos;
}

async function login(email, password) {
  const sesion = await api('POST', '/sesiones', null, { email, password });
  return sesion.token;
}

// ---------------------------------------------------------------- STOMP
/**
 * Un cliente de prueba: conexion STOMP con el token en el CONNECT (igual que el
 * front), reconexion automatica cada 5 s y las suscripciones rehechas en cada
 * conexion. Guarda el socket para poder cortarlo en seco.
 */
function crearCliente(indice, token) {
  const estado = {
    indice,
    conectado: false,
    conexiones: 0,
    flota: 0,
    emergencias: new Map(), // id -> instante de llegada (ms)
    socket: null,
    alConectar: [],
  };
  const client = new Client({
    webSocketFactory: () => {
      // Origin = la direccion del sitio, como lo enviaria el navegador.
      estado.socket = new WebSocket(WS_URL, { origin: opt.base });
      return estado.socket;
    },
    connectHeaders: { Authorization: `Bearer ${token}` },
    reconnectDelay: 5000,
    heartbeatIncoming: 10000,
    heartbeatOutgoing: 10000,
    debug: () => {},
  });
  client.onConnect = () => {
    estado.conectado = true;
    estado.conexiones++;
    client.subscribe('/topic/flota', () => {
      estado.flota++;
    });
    client.subscribe('/topic/emergencias', (mensaje) => {
      try {
        const cuerpo = JSON.parse(mensaje.body);
        if (cuerpo?.id && !estado.emergencias.has(cuerpo.id)) {
          estado.emergencias.set(cuerpo.id, performance.now());
        }
      } catch {
        // payload no JSON: no es una emergencia
      }
    });
    for (const fn of estado.alConectar.splice(0)) fn();
  };
  client.onWebSocketClose = () => {
    estado.conectado = false;
  };
  client.onStompError = (frame) => {
    console.log(`       cliente ${indice}: error STOMP ${frame.headers.message ?? ''}`);
  };
  estado.client = client;
  estado.esperarConexion = (ms) =>
    new Promise((resolver, rechazar) => {
      if (estado.conectado) return resolver();
      const t = setTimeout(() => rechazar(new Error('sin conexion')), ms);
      estado.alConectar.push(() => {
        clearTimeout(t);
        resolver();
      });
    });
  return estado;
}

function percentil(valores, p) {
  if (valores.length === 0) return Number.NaN;
  const orden = [...valores].sort((a, b) => a - b);
  const idx = Math.min(orden.length - 1, Math.ceil((p / 100) * orden.length) - 1);
  return orden[Math.max(0, idx)];
}

async function esperarEmergencia(clientes, id, timeoutMs) {
  const limite = performance.now() + timeoutMs;
  while (performance.now() < limite) {
    if (clientes.every((c) => c.emergencias.has(id))) return true;
    await esperar(20);
  }
  return false;
}

const BODY_EMERGENCIA = {
  ubicacion: { lat: 4.736, lng: -74.082 },
  tipo: 'ACCIDENTE',
  nivel: 'MEDIO',
  descripcion: 'Evidencia tiempo real (prueba automatica)',
};

// ---------------------------------------------------------------- prueba
async function main() {
  console.log('\n=== Prueba de tiempo real (RT1, RT2, reconexion) ===');
  console.log(`sitio: ${opt.base}`);
  console.log(`clientes simultaneos: ${opt.clientes}, rondas RT1: ${opt.rondas}\n`);

  // 1. Sesiones. La primera llamada despierta el back si esta en escala cero.
  let token;
  let tokenCierre = null;
  try {
    token = await login(opt.ciudadano, opt.ciudadanoPassword);
    paso('PASO 1  login', true, opt.ciudadano);
  } catch (e) {
    paso('PASO 1  login', false, e.message);
    process.exit(1);
  }
  try {
    tokenCierre = await login(opt.cierre, opt.cierrePassword);
  } catch {
    console.log('       (sin usuario para cerrar las emergencias de prueba; quedaran abiertas)');
  }

  // 2. N clientes conectados a la vez.
  const clientes = Array.from({ length: opt.clientes }, (_, i) => crearCliente(i + 1, token));
  const t0 = performance.now();
  for (const c of clientes) c.client.activate();
  const conexiones = await Promise.allSettled(clientes.map((c) => c.esperarConexion(30000)));
  const conectados = conexiones.filter((r) => r.status === 'fulfilled').length;
  paso(
    'PASO 2  clientes conectados por WebSocket/STOMP',
    conectados === opt.clientes,
    `${conectados}/${opt.clientes} en ${Math.round(performance.now() - t0)} ms`,
  );
  if (conectados === 0) {
    console.log('       Sin conexiones no se puede seguir. Revisa /ws en Nginx y CORS.');
    process.exit(1);
  }

  // 3. RT2: posiciones de la flota en todos los clientes durante la ventana.
  for (const c of clientes) c.flota = 0;
  await esperar(opt.ventana * 1000);
  const cuentas = clientes.map((c) => c.flota);
  const min = Math.min(...cuentas);
  const max = Math.max(...cuentas);
  if (max === 0) {
    paso(
      'PASO 3  RT2 posiciones de la flota en todos los clientes',
      false,
      'ningun cliente recibio /topic/flota: el back no esta simulando (usa "encender-para-demo")',
    );
  } else {
    // Todos ven el mismo flujo; la diferencia tolerada es lo que cae en el borde de la ventana.
    const tolerancia = Math.max(2, Math.ceil(max * 0.1));
    paso(
      'PASO 3  RT2 posiciones de la flota en todos los clientes',
      min > 0 && max - min <= tolerancia,
      `mensajes por cliente en ${opt.ventana} s: min=${min} max=${max} ` +
        `(~${(max / opt.ventana).toFixed(1)}/s por cliente, ${cuentas.reduce((a, b) => a + b, 0)} entregas en total)`,
    );
  }

  // 4. RT1: cada emergencia nueva debe llegar a TODOS los clientes.
  const creadas = [];
  const latencias = [];
  let rondasCompletas = 0;
  for (let r = 1; r <= opt.rondas; r++) {
    const inicio = performance.now();
    const emergencia = await api('POST', '/emergencias', token, BODY_EMERGENCIA);
    creadas.push(emergencia.id);
    const completa = await esperarEmergencia(clientes, emergencia.id, TIMEOUT_EVENTO_MS);
    const llegadas = clientes
      .filter((c) => c.emergencias.has(emergencia.id))
      .map((c) => c.emergencias.get(emergencia.id) - inicio);
    latencias.push(...llegadas);
    if (completa) rondasCompletas++;
    console.log(
      `       ronda ${r}: ${llegadas.length}/${opt.clientes} clientes, ` +
        `max ${Math.round(Math.max(...llegadas, 0))} ms`,
    );
    await esperar(500);
  }
  paso(
    'PASO 4  RT1 cada emergencia llega a todos los clientes',
    rondasCompletas === opt.rondas,
    `${rondasCompletas}/${opt.rondas} rondas completas`,
  );
  const p50 = percentil(latencias, 50);
  const p95 = percentil(latencias, 95);
  const pmax = Math.max(...latencias);
  paso(
    `PASO 5  RT1 latencia de propagacion p95 < ${opt.umbral} ms`,
    p95 < opt.umbral,
    `p50=${Math.round(p50)} ms  p95=${Math.round(p95)} ms  max=${Math.round(pmax)} ms ` +
      `(${latencias.length} entregas, medido desde el envio del reporte)`,
  );

  // 5. Reconexion: corte en seco del cliente 1.
  const victima = clientes[0];
  const otros = clientes.slice(1);
  const conexionesAntes = victima.conexiones;
  const tCorte = performance.now();
  victima.socket?.terminate();
  await esperar(300);
  // Mientras esta caido ocurre algo: el push no le llega, pero queda en el modelo de lectura.
  const mientrasCaido = await api('POST', '/emergencias', token, BODY_EMERGENCIA);
  creadas.push(mientrasCaido.id);
  if (otros.length > 0) await esperarEmergencia(otros, mientrasCaido.id, TIMEOUT_EVENTO_MS);
  const perdioElPush = !victima.emergencias.has(mientrasCaido.id);

  let volvio = false;
  try {
    await new Promise((resolver, rechazar) => {
      const t = setTimeout(() => rechazar(new Error('timeout')), 30000);
      const revisar = setInterval(() => {
        if (victima.conectado && victima.conexiones > conexionesAntes) {
          clearTimeout(t);
          clearInterval(revisar);
          resolver();
        }
      }, 50);
    });
    volvio = true;
  } catch {
    volvio = false;
  }
  paso(
    'PASO 6  REC el cliente cortado se reconecta solo',
    volvio,
    volvio ? `reconectado en ${Math.round(performance.now() - tCorte)} ms` : 'no volvio en 30 s',
  );

  const lectura = await api('GET', '/emergencias', token);
  const enLectura = Array.isArray(lectura) && lectura.some((e) => e.id === mientrasCaido.id);
  paso(
    'PASO 7  REC lo ocurrido durante el corte se recupera por REST',
    enLectura,
    `push recibido durante el corte: ${perdioElPush ? 'no (esperado)' : 'si'}; ` +
      `GET /emergencias la incluye: ${enLectura ? 'si' : 'no'}`,
  );

  if (volvio) {
    const despues = await api('POST', '/emergencias', token, BODY_EMERGENCIA);
    creadas.push(despues.id);
    const llego = await esperarEmergencia([victima], despues.id, TIMEOUT_EVENTO_MS);
    paso('PASO 8  REC tras reconectar vuelve a recibir en vivo', llego);
  } else {
    paso('PASO 8  REC tras reconectar vuelve a recibir en vivo', false, 'no se reconecto');
  }

  // 6. Limpieza.
  let cerradas = 0;
  if (tokenCierre) {
    for (const id of creadas) {
      try {
        await api('PATCH', `/emergencias/${id}`, tokenCierre, { estado: 'CERRADA' });
        cerradas++;
      } catch {
        // se informa abajo
      }
    }
  }
  console.log(`\n       limpieza: ${cerradas}/${creadas.length} emergencias de prueba cerradas`);

  for (const c of clientes) await c.client.deactivate();

  console.log('\n=== RESUMEN ===');
  console.log(`clientes: ${conectados}/${opt.clientes}`);
  console.log(`RT2 flota: min=${min} max=${max} mensajes por cliente en ${opt.ventana} s`);
  console.log(
    `RT1 latencia: p50=${Math.round(p50)} p95=${Math.round(p95)} max=${Math.round(pmax)} ms`,
  );
  console.log(
    fallos === 0
      ? '\nRESULTADO: TODOS LOS PASOS PASARON'
      : `\nRESULTADO: ${fallos} paso(s) FALLARON`,
  );
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`Error inesperado: ${e.message}`);
  process.exit(1);
});
