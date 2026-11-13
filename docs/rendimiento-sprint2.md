# Rendimiento del Sprint 2 — resultados y reproducción

Este documento cierra las tareas T29, T30 y T31 del Sprint 2: deja registrada
la corrida de carga, la decisión sobre la contingencia y el procedimiento para
repetirla.

## Perfil oficial (ESC-7)

El escenario aprobado vive en `loadtest/escenario-rendimiento.js`:

- 8 req/s sostenidos durante 15 minutos (20 operadores × 1 acción cada 5 s, con
  margen 2×).
- 10 clientes STOMP concurrentes suscritos a `/topic/flota`,
  `/topic/emergencias` y `/topic/map.events`.
- Umbrales: p95 HTTP ≤ 500 ms, p99 ≤ 1000 ms, tasa de error < 1 %, y 0
  respuestas 5xx.
- Con `CONSECUTIVO=true` se exige además 0 huecos en el consecutivo de los
  eventos recibidos por suscriptor.

## Corrida registrada (2026-11-06)

Topología: `backend-1` + `backend-2` (mismo jar, sin estado) detrás de nginx en
el puerto 8080, RabbitMQ en fanout, Prometheus y Grafana levantados desde la
rama `feature/sprint2-integracion`.

Herramienta: k6 con executor `ramping-vus` hasta 1000 usuarios concurrentes,
ejecutada desde la misma máquina de desarrollo.

| Indicador | Resultado |
|---|---|
| Peticiones totales | 159.339 |
| Throughput sostenido | 793,9 req/s |
| Tasa de error | 0 % |
| p95 | 15,49 ms |
| p99 | 37,86 ms |
| Máximo | 776 ms |
| Reparto del balanceador | 49,99 % / 50,00 % |

Lectura: la topología de dos instancias sostiene la carga con el balanceador
repartiendo casi exactamente por mitades, y los percentiles quedan muy por
debajo de los umbrales oficiales (p95 ≤ 500 ms, p99 ≤ 1000 ms). La corrida fue
de **estrés** (1000 VUs), no la meseta oficial de 8 req/s durante 15 minutos:
sirve como evidencia de capacidad y de reparto, no sustituye la corrida del
perfil ESC-7.

Procedencia: registro de la sesión de trabajo del equipo del 2026-11-06. No se
inventan números nuevos; si se repite el escenario, se actualiza esta tabla con
la salida de k6.

## Contingencia del canal de tiempo real (T30)

La prueba no incumplió los umbrales, así que **no se activó la contingencia**.
Se activa solo si la corrida del perfil oficial incumple de forma sostenida:

- p95 > 500 ms o p99 > 1000 ms, o
- tasa de error ≥ 1 % o cualquier 5xx, o
- huecos > 0 con `CONSECUTIVO=true`.

En ese caso el ajuste previsto es revisar el tamaño de los lotes de push y la
cola de salida STOMP (la alerta `NexoVitalColaSalidaSaturada` lo detecta), y
reducir la frecuencia de difusión de la flota antes de tocar la capacidad del
backend.

## Cómo reproducirla

1. Levantar la topología escalada desde la raíz del repositorio:

   ```powershell
   docker compose up -d --build
   ```

2. Obtener un token real:

   ```powershell
   $login = Invoke-RestMethod -Method Post -Uri http://localhost:8080/api/v1/sesiones `
       -ContentType 'application/json' `
       -Body '{"email":"ciudadano@nexovital.co","password":"ciudadano123"}'
   $env:TOKEN = $login.token
   ```

3. Corrida del perfil oficial (15 minutos):

   ```powershell
   k6 run -e TOKEN=$env:TOKEN -e SUSCRIPTORES=10 -e CONSECUTIVO=true `
       loadtest/escenario-rendimiento.js
   ```

4. Corrida corta de humo:

   ```powershell
   k6 run -e TOKEN=$env:TOKEN -e DURACION=30s -e SUSCRIPTORES=0 `
       loadtest/escenario-rendimiento.js
   ```

## Limitaciones

- La corrida registrada se hizo en local, no en Azure; los números dependen del
  hardware de la máquina.
- k6 mide por VU: el control de huecos es por suscriptor, la única medición
  honesta posible con la herramienta.
