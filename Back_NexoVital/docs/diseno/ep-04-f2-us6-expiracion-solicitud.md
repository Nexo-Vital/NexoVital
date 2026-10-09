# EP-04.F2.US6 — Dejar expirar una solicitud sin responder

## Qué resuelve

Una solicitud de ambulancia no puede quedar abierta para siempre. Si ningún conductor la acepta a
tiempo, vence: sale de la pantalla de todos los conductores avisados, el ciudadano se entera y
puede volver a pedir, y ninguna ambulancia queda ocupada por ella.

| Tarea de la historia | Cómo se cumple |
|---|---|
| Diseñar el mecanismo de expiración por tiempo límite | Este documento (D1 a D5) |
| Implementar el temporizador y la expiración automática | `SolicitudExpiryScheduler` (barrido cada segundo) y `ExpirarSolicitudesVencidasUseCaseImpl` (actualización condicionada) |
| Probar que la solicitud expirada sigue disponible para otros | `SolicitudExpiracionHttpTest` (E1 a E4) y `SolicitudExpiracionTest` |

**Lectura de "sigue disponible para otros".** El vencimiento es
**global**: lo que sigue disponible para los demás son las **ambulancias** (ninguna queda ocupada
y todas reciben la solicitud siguiente) y las **demás solicitudes** (vencer una no toca a otra que
sigue dentro de su ventana). Se descartó un contador por conductor.

## Lo que había y lo que cambia

| Antes | Con esta historia |
|---|---|
| El navegador del ciudadano calculaba el vencimiento con su reloj (45 s) y el servidor lo aceptaba tal cual (hallazgo M-03). Un reloj atrasado la vencía al instante; uno adelantado la dejaba abierta de más | El servidor fija siempre el vencimiento: `solicitadaEn` + `nexovital.solicitud.timeout-segundos` (60 s), con su propio reloj. El cuerpo de `POST /api/v1/solicitudes` ya no tiene `timeoutEn`; si un cliente lo manda, se ignora |
| El conductor contaba 45 s fijos | Ya resuelto en EP-04.F2.US2: el aviso trae `solicitadaEn` y `timeoutEn` del servidor |
| Sin documento de diseño ni prueba por HTTP con varios conductores | Este documento y `SolicitudExpiracionHttpTest` |

## Decisiones

### D1. Una sola ventana por solicitud, fijada por el servidor

La solicitud guarda `timeoutEn` al crearse. Mientras está `PENDIENTE` y no ha vencido, el primer
`accept` que se confirma gana. Las unidades que llegan tarde por la oferta tardía (EP-04.F2.US1)
ven el tiempo que queda, no una ventana nueva.

### D2. El temporizador es un barrido en el servidor

`SolicitudExpiryScheduler` (`@Scheduled`, cada 1 s) llama a `ExpirarSolicitudesVencidasUseCase`.

| Alternativa | Por qué se descarta |
|---|---|
| Un temporizador en memoria por solicitud | Se pierde si el servidor se reinicia y la solicitud quedaría `PENDIENTE` para siempre |
| Que el navegador del ciudadano o del conductor la cierre | El cliente no decide: puede estar cerrado, sin red o con el reloj mal |
| Revisar el vencimiento solo cuando alguien lee la solicitud | Nadie avisaría a los conductores ni al ciudadano |

El barrido lee de la base, así que sobrevive a reinicios y funciona igual con varias instancias.

### D3. Cerrar es una actualización condicionada

```sql
UPDATE solicitudes_ambulancia
   SET estado = 'TIMEOUT', version = version + 1
 WHERE id = :id AND estado = 'PENDIENTE' AND timeout_en < :ahora
```

1 fila: venció. 0 filas: alguien la aceptó o la canceló antes, o la cerró otro barrido. Vencer
y aceptar compiten por la misma condición (`estado = 'PENDIENTE'`), así que nunca ocurren las dos.
Dos barridos a la vez tampoco duplican el aviso.

### D4. Qué pasa al vencer

| Quién | Qué recibe | Qué ve |
|---|---|---|
| Cada conductor avisado | Un aviso `TIMEOUT` por `/user/queue/solicitudes`, después del commit | La tarjeta y el aviso emergente desaparecen; la solicitud ya no sale en sus pendientes |
| El ciudadano | El mismo aviso `TIMEOUT` | Termina la búsqueda y puede pedir otra |
| Un conductor que acepta tarde | 409 `SOLICITUD_NO_ASIGNABLE` | Su unidad sigue disponible |

Ninguna unidad cambia de estado: solo la ganadora pasa a `EN_MISION`, y aquí no hay ganadora.
Vencer no es rechazar: no se escribe nada en `solicitud_ambulancia_rechazos`.

### D5. Qué no cambia

El detalle (`GET /api/v1/solicitudes/{id}`) sigue mostrando la solicitud vencida a las unidades
avisadas, con estado `TIMEOUT`. La duración de la ventana se configura con
`nexovital.solicitud.timeout-segundos` (60 por defecto).

## Pruebas

| Prueba | Qué exige |
|---|---|
| E1 | Un cuerpo con `timeoutEn` una hora en el pasado crea la solicitud `PENDIENTE` con la ventana del servidor; el conductor la ve entre sus pendientes |
| E2 | Con dos conductores: al vencer, sale de los pendientes de ambos, cada uno recibe un solo `TIMEOUT`, aceptar responde 409 y ninguna unidad queda ocupada |
| E3 | Vencer no registra rechazos; el ciudadano pide otra vez, las dos unidades la reciben y una la acepta |
| E4 | Una solicitud vigente no se afecta cuando vence otra: sigue en los pendientes de ambos y se puede aceptar |
| `SolicitudExpiracionTest` | El barrido cierra, avisa una sola vez, es idempotente y no toca una solicitud dentro de su ventana |

En el perfil de pruebas el barrido está apagado (retraso inicial de una hora) y las pruebas llaman
al caso de uso con el reloj controlable.

## Fuera del repositorio

- `contract/openapi.yaml`: quitar `timeoutEn` del cuerpo de `POST /solicitudes`.
