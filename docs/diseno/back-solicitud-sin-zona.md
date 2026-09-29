# Solicitud de ambulancia sin zona — broadcast a TODAS las disponibles

**Decisión del usuario (2026-09-28):** pedir una ambulancia **no** depende de que
exista una zona afectada. Las zonas quedan como **aviso en el mapa** y no
condicionan el despacho. El back notifica a **todas las ambulancias disponibles**
sin filtro de zona: *"todas las ambulancias aceptan y le da solo a una"*.

**Rama:** `back-evidencia-c2`.

## El hueco

La zona era la **clave del despacho**:

- `SolicitudController.solicitar` exigía `emergenciaId`, `centroAyudaId` y
  `zonaId` (400 si faltaba alguno).
- `SolicitudAmbulancia` los exigía en el dominio (`Objects.requireNonNull`).
- `SolicitarAmbulanciaUseCaseImpl` despachaba por zona con
  `ambulanciaRepository.listarDisponiblesEnZona(zonaId)`, así que una solicitud
  solo llegaba a las unidades de esa zona (o a ninguna).
- El punto de recogida **no existía en la solicitud**: solo `Emergencia.ubicacion`
  lo tenía, de modo que sin emergencia no había a dónde ir.

## Decisión

1. **La solicitud lleva su propia ubicación** (`ubicacion {lat, lng}`): es el
   punto de recogida y el **único campo geográfico obligatorio**.
2. `emergenciaId`, `centroAyudaId` y `zonaId` pasan a **opcionales (nullable)** en
   el DTO, en el dominio y en el entity. Una solicitud autónoma no lleva ninguno.
3. El despacho notifica a **`listarDisponibles()`** (todas las unidades
   `DISPONIBLE`), sin filtro de zona. Quien gana lo decide el **CAS del accept**,
   no el alcance del broadcast (invariante C2 intacta).
4. La excepción `AmbulanciaNoDisponibleException` gana un constructor sin zona;
   su mensaje ya no menciona ninguna zona.

## Delta de contrato

El contrato vive en `arws-inception/contract/README.md` (STOMP) y
`contract/openapi.yaml` (REST). Este cambio **no** está todavía en esos
documentos: se declara aquí como delta, igual que se hizo con el canal
`/topic/alerts` (`docs/diseno/back-alerta-push.md`).

### `POST /api/v1/solicitudes` (request body)

| Campo | Antes | Ahora |
|---|---|---|
| `ubicacion` | no existía | **obligatorio** `{lat, lng}` (finitos) |
| `emergenciaId` | obligatorio (UUID) | opcional, nullable |
| `centroAyudaId` | obligatorio (UUID) | opcional, nullable |
| `zonaId` | obligatorio (no vacío) | opcional, nullable |
| `timeoutEn` | opcional | opcional (sin cambios) |

Respuestas: `201` con la solicitud creada; `409 AMBULANCIA_NO_DISPONIBLE` si no
hay ninguna unidad disponible; `400 DATOS_INVALIDOS` si falta `ubicacion` o no es
un punto finito.

### `SolicitudAmbulanciaDto` (respuesta y `/user/queue/solicitudes`)

| Campo | Cambio |
|---|---|
| `ubicacion` | **nuevo**, siempre presente `{lat, lng}` |
| `emergenciaId` | ahora nullable (`null` en una solicitud autónoma) |
| `centroAyudaId` | ahora nullable |
| `zonaId` | ahora nullable |

### Push al conductor `/user/queue/solicitudes`

`FlotaPushListener.SolicitudPushPayload` añade `ubicacion {lat, lng}` en el frame
de creación (`PENDIENTE`). Los frames de ciclo de vida posteriores la dejan
`null`: el front ya conserva el punto de recogida del frame de creación. El
validador del front (`fromWireSolicitud`) acepta la forma nueva: `emergenciaId` y
`zonaId` nullable y `ubicacion` opcional.

## Verificación

- `mvn test`: 160 tests, 0 fallos (incluye dominio con campos opcionales,
  despacho a todas las disponibles y `400` sin ubicación).
- Front: validador de wire y del DTO REST actualizados en el mismo cambio;
  `fromWireSolicitudAmbulancia` acepta los campos nullable.
- En vivo: el frame crudo de las 5 unidades notificadas con `ubicacion`
  (`stomp-verify.mjs`).
