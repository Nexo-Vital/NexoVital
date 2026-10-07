# EP-04.F2.US1 — Solicitar una ambulancia disponible

## Qué resuelve

El ciudadano pide una ambulancia desde el mapa. La solicitud queda registrada y se notifica
solo a las ambulancias que pueden atenderla en ese momento.

**Regla central.** Una ambulancia recibe la notificación de una solicitud nueva solo si cumple
las tres condiciones a la vez:

1. Su estado es `DISPONIBLE`.
2. Su conductor está conectado (`conectada = true`).
3. Tiene señal (`sinSenal = false`).

| Situación de la unidad | ¿Recibe la solicitud nueva? |
|---|---|
| Disponible, conectada y con señal | Sí |
| En misión (incluye "en escena": `EN_MISION` con `llegadaEn` registrada) | No |
| En ruta (`EN_RUTA`) | No |
| Fuera de servicio (`MANTENIMIENTO`) | No |
| Desconectada, aunque su estado sea disponible | No |
| Sin señal, aunque figure como conectada | No |

| Escenario de la historia | Cómo se cumple |
|---|---|
| 1. Con 4 ambulancias conectadas y disponibles, la solicitud queda registrada y se notifica a las 4 | `POST /api/v1/solicitudes` guarda la solicitud en `PENDIENTE` con la lista de notificadas y, después del commit, envía un aviso a cada conductor |
| 2. Una unidad ocupada, desconectada o sin señal no recibe nada | No entra en la consulta de candidatas (D5), así que no queda en la lista de notificadas |
| 3. Sin ninguna ambulancia conectada y disponible, la solicitud no se registra | 409 `AMBULANCIA_NO_DISPONIBLE`; no se guarda nada (D7) |

## Decisiones

### D1. Flujo de la solicitud

- **Registro.** La solicitud nace en `PENDIENTE`, con su tiempo límite
  (`nexovital.solicitud.timeout-segundos`, 60 s si el cliente no envía `timeoutEn`) y con la
  lista de ambulancias notificadas.
- **La lista de notificadas se fija al crear.** Es una fotografía de las candidatas de ese
  instante. No se le agregan unidades después.
- **Disparo.** El servicio publica `SolicitudCreadaEvent` dentro de la transacción y
  `FlotaPushListener` lo entrega después del commit: una copia a `/user/queue/solicitudes` de
  cada conductor notificado y otra al solicitante.


### D2. La conexión es un dato del servidor

- Campo nuevo `conectada` (booleano) en la ambulancia: dominio, tabla, `AmbulanciaDto` y los
  dos frames de `/topic/flota`.
- **Una unidad nace conectada.** Las ambulancias de demo arrancan conectadas; solo una acción
  del conductor (o el cierre de su sesión) la desconecta.
- La conexión no es un estado. `estado` sigue teniendo los mismos cuatro valores y `conectada`
  se guarda aparte, igual que `sinSenal`.
- Cada cambio de `conectada` sube la `version` de la fila y sale por `/topic/flota`, así que
  todos los mapas lo conocen y pueden ordenarlo.

### D3. Conectarse y desconectarse

Dos comandos REST, solo para el rol conductor. La unidad se resuelve por el conductor
autenticado, igual que `GET /flota/ambulancias/mia`: el cliente no envía un id que pueda
falsificar.

| Comando | Efecto | Respuestas |
|---|---|---|
| `POST /api/v1/flota/ambulancias/mia/conectar` | `conectada = true` | 200 con la ambulancia |
| `POST /api/v1/flota/ambulancias/mia/desconectar` | `conectada = false` | 200 con la ambulancia; 409 `SOLICITUD_EN_CURSO` si tiene una solicitud aceptada |

Cada comando es una sola actualización condicionada, no una lectura seguida de una escritura:

**Regla que queda garantizada: una unidad en misión siempre está conectada.** Para sostenerla,
aceptar una solicitud también exige conexión: la actualización que ocupa la unidad pasa de
`estado = DISPONIBLE` a `estado = DISPONIBLE AND conectada = true`. Aceptar y desconectarse
compiten por la misma fila; gane quien gane, el resultado es coherente:

- Gana aceptar: la unidad queda en misión y conectada; desconectar responde 409.
- Gana desconectar: la unidad queda disponible y desconectada; aceptar responde 409
  `AMBULANCIA_NO_DISPONIBLE` y la solicitud sigue abierta para las demás.

### D4. Desconexión automática al cerrar la sesión

Cerrar la pestaña, recargar la página o cerrar sesión también desconectan. El servidor lo
detecta por el cierre de la sesión de tiempo real (STOMP) del conductor.

- Un componente escucha la apertura y el cierre de sesiones STOMP y cuenta las sesiones
  abiertas de cada conductor. Cuando la cuenta llega a 0 ejecuta la misma actualización de
  "desconectar" de D3.
- Con una solicitud aceptada la actualización afecta 0 filas y la unidad sigue conectada: no
  se puede desconectar a una unidad en misión, ni a mano ni por cerrar la pestaña.
- Un conductor con dos pestañas abiertas sigue conectado mientras quede una.
- Al recargar, el navegador cierra la conexión antes de que la página nueva abra la suya. La
  página nueva lee `conectada = false` y muestra "Conectarse".

### D5. Qué ve el conductor

| Situación | Qué ve |
|---|---|
| Conectado, con una solicitud pendiente que le notificaron y que aún tiene tiempo | La solicitud, con su cuenta regresiva |
| Se desconecta (botón, pestaña, recarga o cierre de sesión) con una pendiente | Deja de verla. La solicitud sigue abierta para las demás |
| Vuelve a conectarse antes de que venza | La solicitud reaparece |
| La solicitud vence | Desaparece para todos. Espera la siguiente |
| Ya aceptó una solicitud | La sigue viendo hasta finalizar el servicio; no puede desconectarse |
| Se conecta después de que se creó una solicitud | No la ve: no estaba entre las notificadas |
| Queda ocupado al aceptar una solicitud, con otra pendiente abierta | La otra pendiente deja de aparecerle |

### D7. Sin ambulancias conectadas y disponibles

- El servidor responde 409 `AMBULANCIA_NO_DISPONIBLE` y no guarda la solicitud. El código de
  error no cambia; el mensaje pasa a ser "No hay ambulancias conectadas y disponibles en este
  momento."
- El front del ciudadano desactiva el botón con ese mismo texto. Cuenta las candidatas con la
  misma regla del servidor (disponible, conectada y con señal) a partir de la flota que ya
  recibe en vivo.
- El 409 sigue siendo necesario aunque el botón esté desactivado: la última candidata puede
  desconectarse entre que el ciudadano mira el mapa y pulsa el botón.

## Pruebas

| # | Caso | Resultado esperado |
|---|---|---|
| S1 | 4 unidades disponibles, conectadas y con señal; un ciudadano solicita | 201; la solicitud queda `PENDIENTE` con las 4 notificadas y cada conductor recibe el aviso |
| S2 | 3 candidatas y 1 en misión | Reciben las 3; la ocupada no está en la lista ni recibe aviso |
| S3 | Unidades en ruta, en mantenimiento, desconectada y sin señal, más 1 candidata | Solo la candidata recibe el aviso |
| S4 | Ninguna candidata | 409 `AMBULANCIA_NO_DISPONIBLE`; no se guarda ninguna solicitud |
| S5 | Solicitud sin `ubicacion` o con coordenadas no finitas | 400 `DATOS_INVALIDOS` |
| S6 | Conectar y desconectar la unidad propia | 200; `conectada` cambia, sube la `version` y sale un frame por `/topic/flota` |
| S7 | Repetir "conectar" estando conectada | 200; no sube la `version` ni sale frame |
| S8 | Desconectar con una solicitud aceptada | 409 `SOLICITUD_EN_CURSO`; la unidad sigue conectada |
| S9 | Un usuario que no es conductor llama a conectar o desconectar | 403 |
| S10 | Se cierra la única sesión STOMP de un conductor disponible | La unidad queda desconectada y sale un frame |
| S11 | Se cierra una de dos sesiones del mismo conductor | La unidad sigue conectada |
| S12 | Se cierra la sesión de un conductor en misión | La unidad sigue conectada y en misión |
| S13 | Carrera: aceptar y desconectar a la vez, varias rondas | Nunca queda una unidad en misión y desconectada; exactamente uno de los dos gana |
| S14 | Carrera: solicitudes creadas mientras una unidad se conecta y desconecta | Toda unidad notificada era candidata en el instante de la consulta; ninguna solicitud queda con una lista incoherente |
| S15 | Una unidad notificada se desconecta e intenta aceptar | 409; la solicitud sigue `PENDIENTE` |
| S16 | `mia/solicitudes/pendientes`: conectada, desconectada, tras vencer y para una unidad no notificada | Devuelve la solicitud solo en el primer caso |
| S17 | Front del conductor: "Conectarse" y "Desconectarse" | Llaman al servidor; el estado inicial sale de la unidad; el botón se desactiva en misión |
| S18 | Front del conductor: recarga con una pendiente y vuelve a conectarse | La solicitud reaparece con el tiempo que le queda |
| S19 | Front del ciudadano: flota sin candidatas | Botón desactivado con el texto de D7; con una candidata se activa |
| S20 | e2e: un ciudadano solicita y un conductor conectado recibe y acepta | Pasa con las unidades de demo conectadas desde el arranque |