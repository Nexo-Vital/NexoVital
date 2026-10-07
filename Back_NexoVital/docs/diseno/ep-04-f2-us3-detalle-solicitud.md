# EP-04.F2.US3 — Visualizar el detalle de una solicitud notificada

## Qué resuelve

El conductor abre una solicitud que le llegó y ve dónde hay que ir y qué tan lejos está, antes
de aceptar o rechazar. Lo que ve es lo que el servidor tiene en ese momento, no solo lo que
trajo el aviso.

| Criterio de la historia | Cómo se cumple |
|---|---|
| Al abrir la solicitud se ve la ubicación de origen | El detalle muestra el punto de recogida de la solicitud (`ubicacion`), leído de `GET /api/v1/solicitudes/{id}` |
| Al abrir la solicitud se ve la distancia estimada | La consola la calcula entre la posición actual de la unidad y el punto de recogida, y la acompaña con el tiempo estimado |
| Se abre desde las notificaciones | Desde la fila del registro y desde la campana de avisos, que lleva a esa misma fila. El aviso emergente ("Ver solicitud") lleva a la tarjeta de la solicitud abierta, que muestra la misma ubicación y distancia |

## Decisiones

### D1. Qué muestra el detalle

- **Ubicación:** la zona declarada o, si no hay, las coordenadas del punto de recogida.
- **Distancia:** distancia de la unidad al punto de recogida. Sin posición de la unidad dice
  "Sin ubicación", nunca un número inventado.
- **Unidades avisadas:** por placa, nunca por identificador interno.
- **Estado** de la solicitud y las tres acciones: Aceptar, Rechazar y Visualizar (centra el mapa).
- "Emergencia" y "Tipo" solo aparecen cuando la solicitud los trae.

El cambio de coordenadas a direcciones (calle, carrera) queda aplazado por decisión del equipo.

### D2. El endpoint: `GET /api/v1/solicitudes/{id}`

Devuelve el mismo `SolicitudAmbulanciaDto` que el resto de rutas de solicitudes: `id`,
`ubicacion`, `estado`, `solicitadaEn`, `timeoutEn`, `ambulanciasNotificadas`,
`ambulanciaAsignadaId`, `llegadaEn`, y los opcionales `emergenciaId`, `centroAyudaId` y `zonaId`.

| Caso | Respuesta |
|---|---|
| La solicitud fue notificada a la unidad del conductor, o está asignada a ella | 200 con la solicitud |
| La solicitud existe pero no fue notificada ni asignada a su unidad | 403 `SOLICITUD_NO_NOTIFICADA` |
| El conductor no conduce ninguna unidad | 403 `SOLICITUD_NO_NOTIFICADA` |
| No existe una solicitud con ese id | 404 `SOLICITUD_NO_ENCONTRADA` |
| Sin sesión | 401 |
| Otro rol (ciudadano, administradores) | 403 `ACCESO_DENEGADO` |

- **Quién puede leer:** solo el rol conductor. La unidad se resuelve en el servidor a partir del
  conductor autenticado, igual que `/flota/ambulancias/mia`; el cliente no envía la unidad.
- **403 y no 404** para una solicitud ajena.
- **El estado no filtra.** Una solicitud tomada, vencida o cancelada sigue siendo legible por
  las unidades a las que llegó, para que la consola pueda decir por qué ya no está abierta.
- **Orden de las comprobaciones:** primero si existe (404) y después si es de la unidad (403).

### D3. La distancia se calcula en la consola

El servidor no devuelve la distancia. Depende de la posición de la unidad, que cambia cada
5 segundos, y la consola ya la tiene y la usa en la tarjeta de la solicitud y en el aviso
emergente. Calcularla en un solo sitio evita que el detalle y la tarjeta muestren dos números.

### D4. Cuándo lee la consola el detalle

Al abrir una fila del registro. La respuesta se aplica a la misma fila que alimentan los avisos
en tiempo real, para que el detalle, la lista y el mapa tengan una sola fuente:

| Lo que responde el servidor | Qué hace la consola |
|---|---|
| Sigue pendiente, o la tiene esta unidad | La fila toma los datos del servidor |
| Asignada a otra unidad | La fila sale del registro y avisa "La solicitud ya fue aceptada por otra ambulancia." |
| Cerrada, vencida o cancelada; o 403; o 404 | La fila sale del registro y avisa "Esta solicitud ya no está disponible." |
| Otro error (red, 500) | Se conserva lo que trajo el aviso y el detalle lo dice |

Si un aviso ya quitó la fila mientras la lectura estaba en curso, la lectura se descarta: el
aviso es más nuevo.

## Pruebas

| # | Caso | Resultado esperado |
|---|---|---|
| D1 | El conductor notificado lee la solicitud | 200 con ubicación, instantes y unidades avisadas iguales a los de la creación |
| D2 | Un conductor cuya unidad estaba ocupada (no notificada) | 403 `SOLICITUD_NO_NOTIFICADA`, sin datos de la solicitud |
| D3 | Un conductor sin unidad | 403 `SOLICITUD_NO_NOTIFICADA` |
| D4 | Un id que no existe | 404 `SOLICITUD_NO_ENCONTRADA` |
| D5 | Sin sesión; y con rol ciudadano | 401; 403 `ACCESO_DENEGADO` |
| D6 | Tras aceptar, leen la unidad asignada y la que perdió | 200 con `estado = ASIGNADA` y la unidad ganadora |
| F1 | Front: abrir la fila lee `GET /solicitudes/{id}` | El detalle muestra los datos del servidor |
| F2 | Front: el servidor dice que otra unidad la tiene | La fila sale y se avisa el motivo |
| F3 | Front: vencida, o 403 | La fila sale y se avisa que ya no está disponible |
| F4 | Front: la lectura falla | Se conserva lo del aviso y el detalle lo dice |
| E1 | e2e: el conductor abre el detalle de una solicitud real | Se ve la ubicación y la distancia, y `GET /solicitudes/{id}` responde 200 |

## Pendiente fuera del repo

- `contract/openapi.yaml`: ruta nueva `GET /solicitudes/{id}` y el código `SOLICITUD_NO_NOTIFICADA`.
