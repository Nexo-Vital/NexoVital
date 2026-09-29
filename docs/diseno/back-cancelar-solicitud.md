# Cancelar la solicitud de ambulancia — estado `CANCELADA`

**Necesidad:** el botón "Cancelar solicitud" del front publicaba por STOMP
(camino demo) y en modo backend **no cancelaba nada**: el back no tenía la
operación. El profesor pidió el escenario no feliz *"solicitud cancelada/vencida"*;
hoy solo existía el vencimiento (`TIMEOUT`).

**Rama back:** `back-evidencia-c2`. **Rama front:** `front-alerta-push`.

## El hueco

`SolicitudController` exponía create / accept / reject / llegada / finalizar /
confirmar, pero **ninguna** operación de cancelación. `SecurityConfig` es
*fail-closed*, así que una ruta nueva sin declarar responde 403 aunque exista.

## Decisión de estado: `CANCELADA` (delta)

El contrato **no** tiene un estado canónico de cancelación. El enum vigente es:

- `arws-inception/contract/openapi.yaml:817` —
  `enum: [PENDIENTE, ASIGNADA, CONFIRMADA, TOMADA, RECHAZADA, TIMEOUT]`.

`RECHAZADA` **existe**, pero se usa con otro sentido: es el rechazo **total** de
la solicitud (todas las unidades rechazaron o nadie respondió antes del timeout),
no la cancelación del solicitante:

- `arws-inception/system-design/01-diseno-alto-nivel.md:79` — *"Si todas rechazan
  o nadie responde antes del timeout (timer server-side), la solicitud pasa a
  `RECHAZADA/TIMEOUT`"*.
- En el back, `RECHAZADA` **nunca se persiste** como estado de la solicitud: es
  solo el discriminante del push al conductor que rechazó
  (`flota/domain/enums/EstadoSolicitud.java:4-6`,
  `flota/application/usecase/FlotaPushListener.java:100-106`,
  `flota/application/usecase/RechazarSolicitudUseCaseImpl.java:22-30`). El front lo
  mapea a `request.rejected`, que es un acuse **por unidad**, no un cierre.

Reutilizar `RECHAZADA` mezclaría "la flota rechazó" con "el ciudadano se
arrepintió", y además el front lo trataría como rechazo por unidad: la tarjeta
del conductor **no** desaparecería. Por eso se agrega un estado propio:

> **Delta:** `EstadoSolicitud` gana `CANCELADA`, el retiro del solicitante
> mientras la solicitud sigue `PENDIENTE`.

`RECHAZADA` se conserva intacto para el rechazo total del contrato.

## Ruta y transición

Se sigue la convención de verbos en español del resto de operaciones
(`/accept`, `/reject`, `/llegada`, `/finalizar`, `/confirmar`; ver
`contract/openapi.yaml:371-469` y `SolicitudController`):

| Operación | Ruta | Rol | Transición |
|---|---|---|---|
| Cancelar | `POST /api/v1/solicitudes/{id}/cancelar` | `ROLE_CIUDADANO` | `PENDIENTE → CANCELADA` (CAS) |

- **Solo el solicitante.** El controller resuelve el principal y el caso de uso lo
  compara con el `solicitanteId` de la solicitud (mismo criterio que `confirmar`).
  Si no coincide: **403 `SOLICITUD_AJENA`**.
- **Solo mientras nadie aceptó.** Si la solicitud ya se movió (asignada/cerrada):
  **409 `SOLICITUD_NO_ASIGNABLE`** con motivo honesto ("La solicitud ya no admite
  esa transición"). Una ambulancia ya asignada va en camino: no se detiene.
- **CAS atómico.** La transición es un único `UPDATE ... WHERE estado =
  PENDIENTE` (`SolicitudJpaRepository.transicionAtomicaEstado`), como el accept y
  el expire: una cancelación que compite con un accept nunca gana dos veces ni
  devuelve 500; el perdedor recibe 409.
- **404** `SOLICITUD_NO_ENCONTRADA` si el id no existe. **500**
  `ERROR_CANCELACION_SOLICITUD` solo si la persistencia falla de verdad.

### Respuesta y push post-commit

`200` con el `SolicitudAmbulanciaDto` en estado `CANCELADA`. El evento
`SolicitudCanceladaEvent` se publica dentro de la transacción y el listener
`AFTER_COMMIT` (`FlotaPushListener.alCancelarSolicitud`) difunde:

- a **cada conductor notificado** por su destino de usuario
  (`/user/queue/solicitudes`), para que su tarjeta desaparezca;
- al **solicitante**, para que su pantalla vuelva al estado inicial.

Es un estado de **solicitud completa** (nadie aceptó), así que se difunde como
`TIMEOUT` y nunca como declive por unidad.

## Qué NO cambia

- `RECHAZADA` y el flujo de rechazo por unidad: intactos (AC4).
- El vencimiento (`TIMEOUT`): sigue cerrando solo solicitudes `PENDIENTE`; una
  cancelada ya no es `PENDIENTE` y no se expira.
- El CAS del accept: sigue exigiendo `PENDIENTE`; una cancelada no se asigna.

## Verificación

- `mvn test`: dominio (`cancelar` solo desde PENDIENTE, terminal, no toca la
  asignación) y HTTP (`200` cancelando `PENDIENTE` con su push a cada conductor
  notificado y al solicitante; `409` cancelando `ASIGNADA`; `403` de otro
  ciudadano; `403` de un rol distinto).
