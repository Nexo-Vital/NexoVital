# EP-04.F1.US1 — Ubicar las ambulancias en el mapa en tiempo real

Fecha: 2026-10-06.
Tarea 1 de la historia: diseñar el canal en tiempo real y la posición simulada (protocolo de
posición continua cada 5 s, estado de reconexión y estado de pérdida de señal).

## Qué resuelve

Todo usuario conectado ve en el mapa dónde está cada ambulancia, sin recargar. La posición es
simulada (no hay GPS real obligatorio), pero el mecanismo se comporta igual que si lo fuera.

| Escenario de la historia | Cómo se cumple |
|---|---|
| 1. La posición cambia cada 5 s y un usuario la ve sin recargar | Simulador o conductor reportan cada 5 s; el frame sale por `/topic/flota` después del commit |
| 2. 10 usuarios ven lo mismo, ninguno desactualizado | `/topic/flota` es un tópico (todos reciben la misma copia) y cada frame lleva `version` para descartar los viejos |
| 3. Quien se conecta tarde ve la última posición de inmediato | La posición se guarda; `GET /api/v1/flota/ambulancias` la devuelve al abrir el mapa |
| 4. Más de 30 s sin reportar: "sin señal", conservando la última posición | Tarea programada del servidor que marca la unidad y publica un frame con su última posición |

## Decisiones

### D1. El canal es `/topic/flota` (STOMP sobre `/ws`); no se crea uno nuevo

Sentido único servidor a clientes. El cliente nunca escribe en el tópico: el conductor reporta
por REST y el servidor es quien publica.

- El interceptor STOMP descarta todo `SEND` de un cliente cuyo destino no empiece por `/app`.
  Lo descarta en silencio (no cierra la sesión).
- En modo demo (`VITE_DEMO_MODE=1`) no hay backend: el front sigue usando su relay propio.

### D2. Posición continua cada 5 s, con dos fuentes

| Fuente | Quién | Cada cuánto | `source` |
|---|---|---|---|
| `SIMULADA` | `FlotaSimulationScheduler` (servidor) | 5 s | `simulated` |
| `DEVICE` | Consola del conductor, por REST | 5 s mientras esté conectado y tenga posición propia | `device` |

### D3. El dispositivo manda sobre el simulador

Si el conductor reporta su unidad, el simulador deja de moverla. Sin esta regla la unidad
saltaría entre la posición real y la simulada.

- Se guarda la fuente del último reporte (`fuente_posicion`).
- El simulador omite las unidades cuya fuente es `DEVICE`.
- Consecuencia: una unidad tomada por un dispositivo que deja de reportar (el conductor
  se desconecta o cierra la sesión) pasa a "sin señal" a los 30s. Vuelve a tener señal cuando el conductor reporta de nuevo.

### D4. Quién detecta la pérdida de señal: el servidor, con una tarea programada

`SenalFlotaScheduler` llama cada segundo a `DetectarSenalPerdidaUseCase`. Mismo patrón que
`SolicitudExpiryScheduler`: barrido sobre la base de datos, seguro ante reinicios.

1. Lee las unidades con `sin_senal = false` y `ultima_posicion_en < ahora - 30 s`.
2. Por cada una ejecuta un `UPDATE` condicionado:
   `SET sin_senal = true, version = version + 1 WHERE id = :id AND sin_senal = false AND ultima_posicion_en < :limite`.
3. Solo si afectó 1 fila publica el evento. El frame sale después del commit.


### D5. Reconexión

- El cliente STOMP reintenta cada 5 s, con latidos de 10 s. Estados del puerto: `CONNECTED`,
  `STALE` (se cayó y está reintentando), `DISCONNECTED` (cerrado a propósito).
- Tras 1,5 s caído aparece la franja "Sin conexión en tiempo real. Reconectando…".
- El broker no reenvía lo publicado durante el corte. Al volver a `CONNECTED` el front se
  resuscribe y vuelve a leer `GET /flota/ambulancias`, con la mezcla por `version` de D6.
- Una caída del canal del espectador no es "sin señal" de una ambulancia: son dos avisos
  distintos (franja de conexión vs. marcador de la unidad).
## Vista en el mapa

- Marcador "sin señal": mismo círculo de ambulancia en gris, con ícono de señal cortada en la
  insignia y la placa en la etiqueta. Color e ícono, nunca solo color. No se quita del mapa.
- Leyenda: fila "Sin señal" con su conteo.
- En la lista de ambulancias cercanas, una unidad sin señal dice "Sin señal" en lugar de un
  tiempo de llegada.

## Pruebas

| # | Caso | Resultado esperado |
|---|---|---|
| P1 | Un cliente suscrito; un reporte de posición | Recibe el frame en menos de 2 s, con `version` |
| P2 | 10 sesiones STOMP suscritas a `/topic/flota`; un reporte | Las 10 reciben el mismo frame (misma `version` y posición) en menos de 2 s |
| P3 | 3 unidades reportan; un cliente nuevo consulta `GET /flota/ambulancias` | Ve la última posición de las 3 y su `ultimaPosicionEn` |
| P4 | Una unidad reporta y pasan 31 s (reloj controlable) | Queda `sinSenal = true`, sale un frame con su última posición, y el segundo barrido no publica nada |
| P5 | La unidad sin señal vuelve a reportar | `sinSenal = false` en la fila y en el frame |
| P6 | Una unidad que nunca reportó | No se marca |
| P7 | Varios barridos simultáneos sobre la misma unidad vencida | Exactamente un frame de sin señal |
| P8 | El simulador sobre una unidad tomada por un dispositivo | No la mueve (0 filas, sin frame) |
| P9 | El simulador con unidades disponible, en misión, en mantenimiento y sin conductor | Mueve las dos primeras, omite las otras |
| P10 | Un cliente envía un `SEND` a `/topic/flota` | Los demás no reciben nada |
| P11 | Front: llega un frame con `version` menor que la conocida | Se descarta |
| P12 | Front: reconexión | Relee la flota y conserva la unidad local más nueva |
| P13 | Front: unidad con `sinSenal` | Marcador gris con ícono propio, sigue en el mapa |
| P14 | Front: consola del conductor conectada, fuera de demo | Reporta por REST cada 5 s y no publica en el tópico |

## Pendiente fuera del repo

- `contract/openapi.yaml`: campos nuevos de `Ambulancia`.
- `contract/README.md` (STOMP): campos nuevos de los frames de `/topic/flota`.
- Wiki del mecanismo de tiempo real de ambulancias.