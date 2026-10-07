# EP-04.F2.US5 — Rechazar una solicitud de ambulancia

## Qué resuelve

Un conductor decide no atender una solicitud que le llegó. A diferencia de aceptar, su decisión
no afecta a las demás ambulancias: la solicitud sigue abierta para ellas.

| Escenario de la historia | Cómo se cumple |
|---|---|
| Rechazo una solicitud notificada a mi ambulancia: sigue visible y disponible para las demás, y mi ambulancia permanece disponible | `POST /api/v1/solicitudes/{id}/reject` responde 200. La solicitud sigue `PENDIENTE` y las demás unidades pueden aceptarla. La unidad que rechaza no cambia de estado |

**Regla que agrega esta historia.** El rechazo queda guardado y es definitivo para esa unidad y
esa solicitud. Quien rechazó sigue viendo la solicitud mientras esté abierta, pero ya no puede
aceptarla.

## Lo que había y lo que cambia

| Antes | Con esta historia |
|---|---|
| El rechazo solo enviaba un aviso; no se guardaba nada | Se guarda qué unidad rechazó y cuándo |
| La unidad que rechazó podía aceptar después | Su `accept` responde 409 `SOLICITUD_YA_RECHAZADA` |
| Al recargar la consola, la solicitud rechazada volvía como tarjeta y aviso emergente | Se lista en el registro como "Rechazada por ti" y no se vuelve a ofrecer |
| El detalle seguía mostrando "Aceptar" activo | "Aceptar" y "Rechazar" quedan desactivados, con el motivo |

No cambia: la solicitud sigue `PENDIENTE`, el aviso `RECHAZADA` llega solo a quien rechazó, el
solicitante no se entera de un rechazo individual y la regla "el primero que acepta gana".

## Decisiones

### D1. El rechazo es por unidad y no cambia la solicitud

Rechazar no es una transición de estado. La solicitud conserva su estado, su tiempo límite y
su versión. Que todas las unidades rechacen tampoco la cierra: sigue abierta hasta que alguien
la acepte, el ciudadano la cancele o venza.

### D2. Dónde se guarda: una tabla aparte

| Alternativa | Por qué se descarta |
|---|---|
| Una lista dentro de la solicitud (como `ambulanciasNotificadas`) | Escribirla cambia la fila de la solicitud y su versión. Un rechazo competiría con la aceptación, el vencimiento y la oferta tardía, que sí escriben esa fila, y dos unidades rechazando a la vez chocarían entre sí |
| Un estado `RECHAZADA` en la solicitud | Cerraría la solicitud para todas con el primer rechazo, que es lo contrario de lo que pide la historia |
| Guardarlo solo en la consola | Se pierde al recargar y el servidor seguiría aceptando a quien rechazó |

Con la tabla aparte, un rechazo nunca toca la fila que disputa la aceptación. La clave compuesta
garantiza que una unidad rechaza una solicitud como máximo una vez.

### D3. El rechazo es definitivo

No hay "deshacer". La unidad que rechazó no puede aceptar esa solicitud después. La comprobación
va en `AceptarSolicitudUseCaseImpl`, antes de la actualización condicionada, así que un intento
de quien rechazó no cambia nada y la solicitud sigue abierta para las demás.

### D4. Rechazar dos veces no cambia nada

El segundo rechazo de la misma unidad responde 200 con la misma solicitud, no escribe una
segunda fila y no vuelve a enviar el aviso.

### D5. Qué responde el servidor

`POST /api/v1/solicitudes/{id}/reject` con `{ "ambulanciaId": "…" }`. Rol: conductor.

| Caso | Respuesta |
|---|---|
| Rechaza una solicitud pendiente que le fue notificada | 200 con la solicitud en `PENDIENTE` y su unidad en `ambulanciasRechazaron` |
| Rechaza de nuevo la misma | 200 igual; no cambia nada |
| La solicitud ya no está pendiente (asignada, cancelada, vencida) | 409 `SOLICITUD_NO_ASIGNABLE` |
| La unidad no fue notificada, o no es la del conductor | 409 `SOLICITUD_NO_ASIGNABLE` |
| La solicitud no existe | 404 `SOLICITUD_NO_ENCONTRADA` |
| Falta `ambulanciaId` | 400 `DATOS_INVALIDOS` |

## Pruebas

| # | Caso | Resultado esperado |
|---|---|---|
| R1 | Una unidad rechaza; otra notificada acepta | 200; solicitud `PENDIENTE`; quien rechaza sigue `DISPONIBLE` y es la única que recibe el aviso; la otra la sigue viendo y la acepta |
| R2 | Quien rechazó intenta aceptar | 409 `SOLICITUD_YA_RECHAZADA`; nada cambia; otra unidad la acepta después |
| R3 | Quien rechazó lee el detalle y sus pendientes | 200 en ambos, con su unidad en `ambulanciasRechazaron` |
| R4 | La misma unidad rechaza dos veces | 200 las dos; un solo registro y un solo aviso |
| R5 | Rechazar una solicitud que otra unidad ya aceptó | 409 `SOLICITUD_NO_ASIGNABLE`; no se registra el rechazo |
| R6 | 4 conductores rechazan a la vez | Los 4 reciben 200; los 4 quedan registrados; la solicitud sigue `PENDIENTE` y una quinta unidad la acepta |
| M1 | Modelo: registrar un rechazo | No cambia estado, tiempo límite ni versión; rechazar dos veces no duplica |
| F1 | Front: la solicitud llega marcada tras recargar | Fila "Rechazada por ti"; sin tarjeta ni aviso emergente; "Aceptar" desactivado con su motivo |
| F2 | Front: rechazar desde el detalle | La fila se queda y "Aceptar" se desactiva de inmediato |
| F3 | Front: una solicitud que rechazó otra unidad | Se ofrece con normalidad |
| F4 | Front: el rechazo falla | No se marca nada |
| E1 | e2e: el conductor 1 rechaza y el 2 acepta | El 1 ve la fila "Rechazada por ti" con "Aceptar" desactivado y su `accept` responde 409; el 2 acepta y gana |

## Límite conocido

Si la misma unidad envía dos rechazos idénticos exactamente a la vez, uno responde 200 y el otro
puede responder 500. El rechazo queda guardado una sola vez y la solicitud no se altera. La
consola no envía un segundo rechazo desde el detalle mientras espera la respuesta del primero.

## Pendiente fuera del repo

- `contract/openapi.yaml`: campo `ambulanciasRechazaron` en la solicitud y el 409
  `SOLICITUD_YA_RECHAZADA` de `accept`.
- Base de datos de producción: crear la tabla `solicitud_ambulancia_rechazos`. En local y en
  pruebas se crea sola.
