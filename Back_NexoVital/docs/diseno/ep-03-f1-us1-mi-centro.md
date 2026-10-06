# EP-03.F1.US1 — Centro propio del administrador de centro de ayuda

Fecha: 2026-10-05.

## Qué resuelve

El administrador de centro de ayuda entra a la misma pantalla del ciudadano
(mapa, pedir ambulancia, reportar zona) con una diferencia: en lugar de "Donar
suministros" tiene "Crear centro" o, si ya lo creó, "Administrar mi centro".
Desde ahí declara los insumos que pide, agrega insumos nuevos y retira unidades
que salieron del centro.

## Decisiones

- **Un centro por administrador.** `organizaciones.admin_id` guarda el usuario
  dueño; es nulo en los centros sembrados y único para los demás. La
  comprobación previa da el mensaje claro y la restricción única decide bajo
  concurrencia.
- **El centro creado es un `CENTRO_ACOPIO` sin zona.** Aparece en `GET /mapa`,
  tiene semáforo y recibe donaciones igual que los sembrados.
- **El cliente nunca envía el id del centro** para crear o agregar insumos: el
  servidor lo resuelve con el usuario autenticado (`/centros-acopio/mio`).
- **Retirar unidades es el despacho que ya existe**
  (`POST /centros-acopio/{id}/inventario/despacho`), con su descuento atómico
  (C1). No se agregó otra operación de resta.
- **`disponible` puede superar a `requerido`** al declarar un insumo: el
  semáforo lo muestra como completo.
- **El administrador comparte la pantalla del ciudadano**, así que también puede
  `POST /emergencias`, `POST /solicitudes` y confirmar o cancelar su propia
  solicitud. Los casos de uso siguen verificando que quien confirma o cancela es
  el solicitante.

## Operaciones nuevas

Todas exigen `ROLE_ADMIN_CENTRO_AYUDA`.

| Operación | Respuesta | Errores |
|---|---|---|
| `GET /api/v1/centros-acopio/mio` | 200 `{id, nombre, ubicacion, items}` | 404 `CENTRO_NO_REGISTRADO` |
| `POST /api/v1/centros-acopio/mio` con `{nombre, ubicacion:{lat,lng}, items:[{nombre, disponible, requerido}]}` | 201, misma forma | 400 `DATOS_INVALIDOS` (el mensaje nombra el dato), 409 `CENTRO_YA_REGISTRADO`, 409 `NOMBRE_CENTRO_DUPLICADO` |
| `POST /api/v1/centros-acopio/mio/inventario` con `{nombre, disponible, requerido}` | 201 `InventarioItem` | 400 `DATOS_INVALIDOS`, 404 `CENTRO_NO_REGISTRADO`, 409 `ITEM_INVENTARIO_DUPLICADO` |

Reglas de validación: nombre obligatorio (máximo 120 caracteres), al menos un
insumo y máximo 30 al crear, nombres de insumo sin repetir (sin distinguir
mayúsculas), `disponible` entre 0 y 1.000.000, `requerido` entre 1 y 1.000.000.

## Transacción y tiempo real

La creación es una sola transacción: `recursos` valida los insumos, pide a
`usuarios` registrar el centro (por `CentroPropioPort`, que delega en
`CentroDeAdministradorUseCase`) e inserta los insumos. Un insumo inválido
deshace también el centro.

Después del commit se publica el centro en `/topic/map.events`
(`mapa.elemento.upsert`, lo emite `usuarios`) y cada insumo en
`/topic/suministros`. Agregar un insumo publica en `/topic/suministros`.

## Frontera entre módulos (ADR-0003)

`recursos` no lee el esquema de `usuarios`: usa `CentroPropioPort`, cuyo
adaptador llama al puerto de entrada `CentroDeAdministradorUseCase` y traduce
sus tipos y excepciones. Es el mismo patrón de `CentroAcopioQueryPort`.

## Pruebas

- `MiCentroHttpTest`: consulta, creación, un solo centro por administrador,
  nombre duplicado, datos inválidos, alta de insumo y retiro con el despacho.
- `EmergenciasHttpTest`: el rol sin permiso para reportar pasa a ser
  `ADMIN_ACOPIO`, y se agrega el caso en que el administrador de centro reporta.

## Pendiente fuera del repo

- `contract/openapi.yaml`: las tres operaciones de `/centros-acopio/mio` y los
  roles adicionales de `/emergencias` y `/solicitudes`.
- El despacho sigue abierto a cualquier usuario autenticado. Restringirlo al
  dueño del centro es una decisión aparte.
