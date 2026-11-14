# Rendimiento del Sprint 2 — perfil, resultados y reproducción

Este documento cubre las tareas T26, T28, T29, T30 y T31 del Sprint 2
(EP-06.F4.US1 "Recibir eventos en tiempo real en 500 ms o menos"): el perfil de
carga, el script, la corrida registrada, la decisión sobre la contingencia y el
procedimiento para repetirla.

## Perfil de carga (T26): escenario R-1

Sale del documento de escenarios de calidad del Sprint 2.

| Elemento | Valor |
|---|---|
| Fuente | 200 usuarios conectados al mapa: ciudadanos, conductores y administradores de centros |
| Estímulo | Cada usuario envía 1 petición por segundo durante 10 minutos (unas 120.000 peticiones) |
| Entorno | Los 200 clientes con su WebSocket abierto al mismo tiempo durante toda la prueba |
| Artefacto | El canal de tiempo real (STOMP sobre SockJS) y el backend, con dos instancias detrás de nginx y RabbitMQ en fanout |

**Umbrales (medida de respuesta):**

| Medida | Cómo se mide en el script |
|---|---|
| El 95 % de los eventos llega en 500 ms o menos | `propagacion_ms` p95 ≤ 500 ms: diferencia entre la recepción en el cliente y la cabecera `emitidoEn` que pone la instancia que publica (T27) |
| Ningún evento se pierde | `huecos_detectados` = 0: cada cliente sigue el `consecutivo` por instancia y destino; un salto es un evento perdido |
| Tasa de errores menor al 1 % | `http_req_failed` < 1 % y, además, 0 respuestas 5xx |
| La latencia del último minuto no es peor que la del primero | p95 del minuto 10 frente al p95 del minuto 1 (ver la regla abajo) |

**Regla de "no peor".** Con latencias de pocos milisegundos, cualquier ruido
haría "peor" al último minuto, así que el equipo fija un margen: el último
minuto no empeora si su p95 es menor o igual al mayor entre p95 del primer
minuto + 10 % y p95 del primer minuto + 20 ms. Los dos valores se pueden ajustar
con `TOLERANCIA` y `MARGEN_MS`.

**Reparto de los 200 usuarios.** Los eventos nacen de escrituras y la base solo
tiene 5 ambulancias, así que:

| Usuarios | Rol | Petición de cada segundo | Evento que genera |
|---|---|---|---|
| 5 | Conductores (`conductor1..5`) | Reportan la posición de su propia unidad (`POST /flota/ambulancias/{id}/posicion`) | Movimiento de una ambulancia en `/topic/flota` |
| 1 | Administrador de acopio (`acopio`) | Alterna despacho y donación de 1 unidad de un insumo de su centro | Cambio del semáforo en `/topic/suministros` |
| 194 | Ciudadanos y administradores de centros (`ciudadano`, `ciudadano2`, `centro`, `rangel`) | Consultan el mapa, la flota o las emergencias | Ninguno: reciben todos los eventos |

Los 200 están suscritos a `/topic/flota`, `/topic/suministros`,
`/topic/emergencias` y `/topic/map.events`. Cada evento se entrega a los 200, así
que la latencia medida es la de un evento real repartido a todos los clientes
interesados.

## Script (T28)

`loadtest/escenario-rendimiento.js` (k6). Inicia sesión solo con las cuentas
semilla, así que no hace falta sacar un token a mano.

- Todos los usuarios se conectan escalonados durante una rampa de 20 s
  (`RAMPA_S`) y se quedan conectados hasta el final de la meseta. El minuto 1 de
  la medición empieza al terminar la rampa.
- Cada usuario dispara su petición una vez por segundo, con un desfase
  aleatorio dentro del segundo para que los 200 no disparen a la vez.
- Al terminar imprime un resumen propio con cada umbral, el p95 del primer y del
  último minuto y el veredicto **CUMPLE / NO CUMPLE**. Con
  `RESUMEN_JSON=<ruta>` guarda además el resumen completo en JSON.
- El perfil anterior (ESC-7: 8 req/s durante 15 minutos con 10 clientes STOMP)
  sigue disponible con `PERFIL=esc7`.

Variables: `BASE_URL`, `WS_BASE`, `PERFIL`, `USUARIOS`, `DURACION`, `RAMPA_S`,
`RATE` (solo ESC-7), `TOLERANCIA`, `MARGEN_MS`, `RESUMEN_JSON`. El encabezado
del script explica cada una.

## Cómo reproducirla (Mac, zsh)

1. Levantar las dos instancias con el compose de pruebas. Enciende el login
   local, que es el que usa el script, y sube el límite T18: el administrador de
   acopio dona 30 veces por minuto y el límite real es 10.

   ```zsh
   cd NexoVital
   PRUEBA_LIMITE_USUARIO=100000 PRUEBA_LIMITE_IP=100000 \
     docker compose -f docker-compose.yml -f docker-compose.pruebas.yml up -d --build
   docker compose ps
   ```

   Todos los servicios deben quedar `running` o `healthy` antes de seguir.

2. Corrida corta de humo (20 usuarios, 1 minuto) para comprobar que todo
   conecta:

   ```zsh
   k6 run -e USUARIOS=20 -e DURACION=1m loadtest/escenario-rendimiento.js
   ```

3. Corrida oficial R-1 (200 usuarios, 10 minutos, unos 11 minutos en total):

   ```zsh
   mkdir -p evidencias-nube
   k6 run -e RESUMEN_JSON=evidencias-nube/resultado-r1.json loadtest/escenario-rendimiento.js \
     | tee evidencias-nube/resultado-r1.txt
   ```

   Los dos archivos son la evidencia. `evidencias-nube/` está en el
   `.gitignore`: no se versionan, se adjuntan a la Wiki.

4. Al terminar, volver al compose normal (los límites reales y el login local
   apagado):

   ```zsh
   docker compose up -d
   ```

**Durante la corrida** se puede mirar en Grafana (`http://localhost:3000`) el
tablero técnico: las dos instancias con carga pareja y el panel de latencia de
propagación (`nexovital.push.propagacion`), que mide lo mismo desde el lado del
servidor.

## Corrida registrada (T29)

Corrida oficial R-1 del 2026-11-13, en local (Docker: nginx, dos instancias,
RabbitMQ y PostgreSQL), con `PRUEBA_LIMITE_USUARIO` y `PRUEBA_LIMITE_IP` subidos
y el secreto JWT compartido. Números copiados tal cual de la salida del script
(`evidencias-nube/resultado-r1.txt` y `.json`):

| Indicador | Umbral | Resultado |
|---|---|---|
| Usuarios conectados (suscritos) | 200 de 200 | 200 de 200 |
| Duración de la meseta | 10 min | 10 min |
| Peticiones HTTP (req/s) | — | 121.146 (194,5 req/s) |
| Tasa de errores HTTP | < 1 % | 0,000 % |
| Respuestas 5xx | 0 | 0 |
| Eventos recibidos | > 0 | 727.293 |
| Eventos sin marca de tiempo | — | 0 |
| Eventos perdidos (huecos) | 0 | 0 |
| Eventos desordenados (llegaron todos) | informativo | 4.600 (0,63 % de los recibidos) |
| Latencia de eventos p95 | ≤ 500 ms | 14,0 ms |
| p95 primer minuto / último minuto | último no peor | 11,0 ms / 15,0 ms (tope admitido 31,0 ms) |
| HTTP p95 / p99 | p95 < 500 ms, p99 < 1000 ms | 14,3 ms / 22,4 ms |
| Errores de WebSocket | — | 0 |
| **Veredicto** | | **CUMPLE** |

Como se cumplen todos los umbrales, **la contingencia T30 no se activa**.

**Lectura de los resultados**

- Ningún evento se perdió. Los 4.600 desordenados son eventos que llegaron
  después de otro con consecutivo mayor (publicadores concurrentes en una
  misma instancia); todos llegaron dentro de la gracia de 3 s, así que no
  cuentan como hueco.
- La latencia no se degradó con el tiempo: el último minuto (15 ms) está dentro
  del margen respecto al primero (11 ms).

**Evidencia en Grafana (tablero técnico, ventana de 15 min).** Lectura
aproximada de las capturas durante la corrida:

- Estado de componentes: `backend-1`, `backend-2`, base de datos y RabbitMQ
  operativos.
- Tiempo de respuesta promedio: unos pocos ms en estado estable, con un pico
  inicial de arranque (hasta ~60 ms de p95) que se estabiliza en menos de un
  minuto; las dos instancias se comportan igual.
- Latencia de eventos en tiempo real: p95 entre ~3 y ~8 ms en ambas instancias,
  muy por debajo del objetivo de 500 ms.
- CPU del proceso entre ~1 % y ~3,5 %, heap JVM muy por debajo del máximo y
  errores 5xx en 0.
- Cola de los canales STOMP en 0 todo el tiempo (ninguna instancia saturada);
  pool de conexiones a base de datos sin hilos en espera (pico de 12 conexiones
  activas en `backend-1`, sin esperas).

### Antecedente: corrida de estrés (2026-11-06)

Antes de fijar el perfil R-1 se hizo una corrida de estrés con k6
(`ramping-vus` hasta 1000 usuarios, solo HTTP) contra la misma topología de dos
instancias. Sirve como evidencia de capacidad y de reparto, no sustituye la
corrida R-1:

| Indicador | Resultado |
|---|---|
| Peticiones totales | 159.339 |
| Throughput sostenido | 793,9 req/s |
| Tasa de error | 0 % |
| p95 / p99 HTTP | 15,49 ms / 37,86 ms |
| Máximo | 776 ms |
| Reparto del balanceador | 49,99 % / 50,00 % |

## Contingencia del canal de tiempo real (T30)

Se activa solo si la corrida R-1 incumple algún umbral:

- p95 de eventos > 500 ms, o el último minuto peor que el primero;
- huecos > 0;
- tasa de error ≥ 1 % o cualquier 5xx.

En ese caso el ajuste previsto es, en orden: revisar el tamaño de la cola de
salida STOMP y del pool del canal de salida (la alerta
`NexoVitalColaSalidaSaturada` lo detecta), reducir la frecuencia de difusión de
la flota y, por último, revisar la capacidad del backend.

## Limitaciones

- La corrida se hace en local: k6, nginx, las dos instancias, RabbitMQ y
  PostgreSQL comparten la misma máquina, así que los números dependen de su
  hardware.
- Los 194 lectores comparten 4 cuentas: la base no tiene 194 usuarios reales.
  Cada uno tiene su propia conexión STOMP, que es lo que mide el escenario.
- Solo hay 5 ambulancias, así que los eventos de flota los generan 5 usuarios.
  Los demás generan carga HTTP y reciben los eventos.
- Mientras un conductor reporta posición desde la prueba, esa unidad deja de
  moverse por el simulador (el dispositivo manda sobre el simulador).
- k6 mide por usuario virtual: el control de huecos es por suscriptor, que es la
  única medición honesta posible con la herramienta.
