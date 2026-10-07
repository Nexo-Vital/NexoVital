# EP-04.F2.US4 — Aceptar una solicitud de ambulancia

## Qué resuelve

Una solicitud se notifica a varias ambulancias a la vez y varios conductores pueden aceptarla
casi en el mismo instante. Solo uno puede quedarse con ella, sin importar en qué orden procese
el servidor las respuestas.

| Escenario de la historia | Cómo se cumple |
|---|---|
| 1. Con 4 unidades notificadas, yo acepto: quedo asignado, mi ambulancia pasa a ocupada y la solicitud desaparece de las otras 3 | `POST /api/v1/solicitudes/{id}/accept` responde 200. En una sola transacción la solicitud pasa a `ASIGNADA` con mi unidad y mi unidad pasa a `EN_MISION`. Después del commit, las otras 3 reciben el aviso `ASIGNADA` y la consola quita la solicitud |
| 2. Dos conductores aceptan casi a la vez: solo el primero queda asignado; el segundo recibe de inmediato "solicitud ya asignada" y la solicitud desaparece de su pantalla | La actualización condicionada (D1) deja pasar a uno solo. El otro recibe 409 con el mensaje "Solicitud ya asignada a otra ambulancia." y la consola quita la solicitud |

## Decisiones

### D1. La garantía: una actualización condicionada sobre la solicitud

Quien acepta ejecuta una sola sentencia que cambia el estado **solo si la solicitud sigue
pendiente**:

```sql
UPDATE solicitudes_ambulancia
   SET estado = 'ASIGNADA', ambulancia_asignada_id = :unidad, version = version + 1
 WHERE id = :solicitud AND estado = 'PENDIENTE'
```

- **1 fila afectada:** esta llamada ganó.
- **0 filas afectadas:** otra llamada ganó antes. No se cambia nada.

La base de datos evalúa la condición y escribe en un mismo paso. Si dos transacciones llegan a
la vez, la segunda espera el bloqueo de la fila; cuando la primera confirma, la segunda vuelve a
evaluar `estado = 'PENDIENTE'`, ya no se cumple y afecta 0 filas. No existe un momento en que
las dos vean la solicitud libre y las dos escriban.

### D2. Por qué no otro mecanismo

| Alternativa | Por qué se descarta |
|---|---|
| Leer el estado y luego guardar (`if pendiente → save`) | Dos conductores leen "pendiente" antes de que alguno guarde y los dos se la quedan |
| Bloqueo en memoria (`synchronized`, un mapa de candados) | Solo protege dentro de un proceso. Con dos instancias del back deja de servir, y se pierde si el proceso se reinicia |
| Que el front desactive el botón o decida quién ganó | El cliente no es fuente de verdad: dos pantallas distintas no se ven entre sí |
| Bloqueo pesimista (`SELECT … FOR UPDATE`) | Funciona, pero mantiene la fila bloqueada durante toda la transacción y son dos viajes a la base. La actualización condicionada da la misma garantía con una sentencia |
| Solo control de versión (`@Version`) | El perdedor recibe una excepción de versión que habría que traducir. Con la actualización condicionada perder es un resultado normal (0 filas), no un error |

Es la misma regla del resto del proyecto: los invariantes se garantizan con operaciones atómicas
en la base de datos, nunca con bloqueos en memoria ni banderas en el cliente.

### D3. La unidad también se ocupa con una actualización condicionada

Ganar la solicitud no basta: la unidad debe pasar a ocupada, y eso también puede competir (dos
solicitudes distintas que aceptan con la misma unidad, o un conductor que se desconecta justo
en ese momento). Por eso el cambio de la unidad es otra sentencia condicionada:

```sql
UPDATE ambulancias
   SET estado = 'EN_MISION', version = version + 1
 WHERE id = :unidad AND estado = 'DISPONIBLE' AND conectada = true
```

En el código: `AmbulanciaRepository.ocuparAtomica`.

- 1 fila: la unidad queda ocupada.
- 0 filas: la unidad ya no estaba libre o se desconectó. Se lanza
  `AmbulanciaNoDisponibleException` y **toda la transacción se revierte**: la solicitud vuelve a
  `PENDIENTE` y sigue abierta para las demás unidades.

### D4. Una sola transacción, avisos después del commit

1. Leer la solicitud. Si ya no está `PENDIENTE` se responde 409 sin intentar nada.
2. Validar la unidad: existe, está disponible y conectada, fue notificada de esa solicitud y es
   la que conduce el usuario autenticado. El cliente envía `ambulanciaId`, pero el servidor no
   confía en ese dato.
3. Actualización condicionada de la solicitud (D1).
4. Actualización condicionada de la unidad (D3).
5. Commit.
6. **Después del commit** se publican los avisos (`@TransactionalEventListener(AFTER_COMMIT)`):
   al solicitante, a la flota (`/topic/flota`, la unidad pasa a ocupada) y a cada una de las
   otras unidades notificadas (`/user/queue/solicitudes`, estado `ASIGNADA` con la unidad
   ganadora). Nunca se avisa de algo que la base no confirmó.

Los pasos 1 y 2 son comprobaciones para dar una respuesta clara. La garantía son los pasos 3 y 4.

### D5. Qué responde el servidor

`POST /api/v1/solicitudes/{id}/accept` con `{ "ambulanciaId": "…" }`. Rol: conductor.

| Caso | Respuesta |
|---|---|
| Gana | 200 `{ ganador: true, solicitud }` con `estado = ASIGNADA` y `ambulanciaAsignadaId` |
| Pierde dentro de la actualización condicionada (0 filas) | 409 `CAS_PERDIDO` — "Solicitud ya asignada a otra ambulancia." |
| Llega cuando otra unidad ya la tiene | 409 `SOLICITUD_NO_ASIGNABLE` — "Solicitud ya asignada a otra ambulancia." |
| La solicitud está cancelada o vencida, la unidad no fue notificada, o no es la del conductor | 409 `SOLICITUD_NO_ASIGNABLE` — "La solicitud ya no admite esa transición." |
| La unidad está ocupada o desconectada | 409 `AMBULANCIA_NO_DISPONIBLE` |
| La solicitud no existe | 404 `SOLICITUD_NO_ENCONTRADA` |
| Falta `ambulanciaId` | 400 `DATOS_INVALIDOS` |
| Sin sesión / otro rol | 401 / 403 `ACCESO_DENEGADO` |

### D6. Qué hace la consola del conductor

- **Gana:** abre la misión con los datos que devolvió el servidor.
- **Pierde** (409 `CAS_PERDIDO` o `SOLICITUD_NO_ASIGNABLE`): quita la tarjeta y la fila al
  instante y avisa una sola vez "La solicitud ya fue aceptada por otra ambulancia.".
- **No aceptó pero estaba notificada:** recibe el aviso `ASIGNADA` y quita la solicitud igual.
- La consola nunca decide quién ganó: espera la respuesta del servidor.

## Pruebas

| # | Caso | Resultado esperado |
|---|---|---|
| A1 | 4 unidades notificadas; una acepta | 200; solicitud `ASIGNADA` a esa unidad; unidad `EN_MISION`; las otras 3 reciben un aviso `ASIGNADA`, ya no la tienen entre sus pendientes y siguen `DISPONIBLE` |
| A2 | 4 conductores aceptan a la vez por HTTP (5 rondas) | Exactamente un 200; los otros 3 reciben 409 con "Solicitud ya asignada a otra ambulancia."; una sola unidad `EN_MISION` |
| A3 | Un conductor acepta después de que otro ganó | 409 `SOLICITUD_NO_ASIGNABLE` con "Solicitud ya asignada a otra ambulancia." |
| A4 | Aceptar una solicitud cancelada | 409 `SOLICITUD_NO_ASIGNABLE` sin decir que otra ambulancia la tiene |
| C1 | 12 aceptaciones simultáneas contra el caso de uso (8 rondas) | Exactamente un ganador por ronda |
| C2 | Dos solicitudes distintas aceptan con la misma unidad | Una gana; la otra recibe `AMBULANCIA_NO_DISPONIBLE` y su solicitud vuelve a `PENDIENTE` |
| F1 | Front: la respuesta dice que otra unidad ganó | La solicitud sale de la pantalla con un único aviso |

## Pendiente fuera del repo

- `contract/openapi.yaml`: el mensaje del 409 de `accept` cuando otra unidad ya tiene la solicitud.
- Wiki de Azure DevOps: página "Concurrencia de ambulancias" (tarea 4 de la historia).
