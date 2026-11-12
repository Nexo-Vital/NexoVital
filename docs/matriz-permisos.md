# Matriz de permisos por rol y por recurso (EP-06.F2.US1 · T09)

Escenario de calidad **S-1** (autenticación con Google y autorización por rol y por recurso): el backend valida el token del proveedor externo en cada solicitud y en el CONNECT del WebSocket (**401** si falla), verifica además el rol y la pertenencia del recurso (**403** si no corresponde) y registra ambos intentos.

## 1. Cómo se decide

| Paso | Dónde | Resultado si falla | Registro en el log |
|---|---|---|---|
| 1. ¿Hay token válido? | `JwtAuthFilter` + `SecurityConfig` (entry point) | 401 `NO_AUTENTICADO` | `autenticacion_fallida canal=http motivo=token_ausente\|token_invalido` |
| 1b. ¿El CONNECT del WebSocket trae un token válido? | `StompAuthChannelInterceptor` | No se abre la conexión | `autenticacion_fallida canal=stomp motivo=...` |
| 1c. ¿El token es válido pero el usuario no tiene cuenta? | `ResolutorSesionFirebase` + entry point | 401 `USUARIO_NO_REGISTRADO` | `autenticacion_fallida ... motivo=usuario_no_registrado` |
| 2. ¿El rol puede usar el endpoint? | `SecurityConfig` (matchers por método y ruta) | 403 `ACCESO_DENEGADO` | `acceso_denegado ... motivo=rol_insuficiente` |
| 3. ¿El recurso es del usuario? | Casos de uso y controladores | 403 con código del recurso | `acceso_denegado ... motivo=recurso_ajeno` |
| 4. ¿El estado permite la acción? | Casos de uso | 409 | — |

El orden importa: la pertenencia (paso 3) se verifica **antes** que el estado (paso 4), para que un usuario ajeno reciba siempre 403 y no aprenda nada del estado del recurso. Toda ruta que no esté en la matriz se rechaza (`anyRequest().denyAll()`).

## 2. Matriz por rol

Roles: **CIU** = Ciudadano, **CON** = Conductor, **ACA** = Admin. centro de acopio, **ACY** = Admin. centro de ayuda, **APL** = Admin. de plataforma.

✅ = permitido · ❌ = 403 por rol · 🔒 = permitido solo sobre el recurso propio (si no, 403 por recurso)

| Endpoint | CIU | CON | ACA | ACY | APL | Regla de pertenencia (paso 3) |
|---|:-:|:-:|:-:|:-:|:-:|---|
| `GET /sesiones/actual`, `GET /mapa`, `GET /emergencias`, `GET /organizaciones` | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| `POST /emergencias` | ✅ | ❌ | ✅ | ✅ | ❌ | — (además, límite de 10/min por usuario) |
| `PATCH /emergencias/{id}` | ❌ | ❌ | ❌ | ❌ | ✅ | — (solo la plataforma corrige emergencias; ver nota 1) |
| `POST /organizaciones` | ❌ | ❌ | ❌ | ❌ | ✅ | — |
| `POST /registros` | token válido de Google sin cuenta | | | | | El rol se elige entre CIU, ACY y CON (ver sección 4). Si el usuario ya existe → 409. Conductor con placa repetida → 409 |
| `GET / POST /centros-acopio/mio`, `POST /centros-acopio/mio/inventario` | ❌ | ❌ | ✅ | ✅ | ❌ | 🔒 Implícita: `mio` se resuelve con el usuario del token |
| `GET /centros-acopio/{id}/inventario` | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| `POST /centros-acopio/{id}/inventario/donacion` | ✅ | ✅ | ✅ | ✅ | ✅ | — (límite de 10/min por usuario) |
| `POST /centros-acopio/{id}/inventario/despacho` | ❌ | ❌ | 🔒 | 🔒 | ✅ | Solo el admin **de ese centro**; APL puede en cualquiera → 403 `NO_ES_DUENO_DEL_CENTRO` |
| `GET /flota/ambulancias` | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| `GET /flota/ambulancias/mia`, `…/mia/solicitudes`, `…/mia/solicitudes/pendientes` | ❌ | 🔒 | ❌ | ❌ | ❌ | 🔒 Implícita: `mia` se resuelve con el conductor del token |
| `POST /flota/ambulancias/mia/conectar · desconectar · disponibilidad` | ❌ | 🔒 | ❌ | ❌ | ❌ | 🔒 Implícita (`mia`) |
| `POST /flota/ambulancias/{id}/posicion` | ❌ | 🔒 | ❌ | ❌ | ❌ | La unidad debe ser del conductor → 403 `AMBULANCIA_AJENA` |
| `POST /solicitudes` | ✅ | ❌ | ✅ | ✅ | ❌ | — |
| `GET /solicitudes/mias` | ✅ | ❌ | ✅ | ✅ | ❌ | 🔒 Implícita: lista las del usuario del token |
| `GET /solicitudes/{id}` | ❌ | 🔒 | ❌ | ❌ | ❌ | La solicitud debe haber sido notificada o asignada a su unidad → 403 `SOLICITUD_NO_NOTIFICADA` |
| `POST /solicitudes/{id}/accept · reject · llegada · finalizar` | ❌ | 🔒 | ❌ | ❌ | ❌ | La unidad enviada debe ser del conductor → 403 `AMBULANCIA_AJENA` **(corregido en Sprint 2)** |
| `POST /solicitudes/{id}/confirmar` | 🔒 | ❌ | 🔒 | 🔒 | ❌ | Solo quien creó la solicitud → 403 `SOLICITUD_AJENA` **(corregido en Sprint 2)** |
| `POST /solicitudes/{id}/cancelar` | 🔒 | ❌ | 🔒 | 🔒 | ❌ | Solo quien creó la solicitud → 403 `SOLICITUD_AJENA` |
| `GET /auditoria/**` | ❌ | ❌ | ❌ | ❌ | ✅ | Incluye `GET /auditoria/peticiones`, la bitácora de todas las peticiones (S-2, T15). Ver `trazabilidad.md` |
| Canal en tiempo real (`/ws`, CONNECT y SUBSCRIBE) | ✅ | ✅ | ✅ | ✅ | ✅ | Requiere token válido en el CONNECT. Los clientes no pueden publicar en `/topic` ni en `/queue` |
| `/actuator/health`, `POST /sesiones` (login local de desarrollo, 404 en docker y prod) | público | | | | | — |

Todas las rutas van con el prefijo `/api/v1`, salvo `/ws` y `/actuator`.

## 3. Notas

1. **`PATCH /emergencias/{id}`** es solo de ADMIN_PLATAFORMA. El administrador de centro no puede editar emergencias, porque la emergencia no guarda quién la reportó ni qué centro la atiende, y por eso no hay regla de pertenencia posible sin cambiar el modelo.
2. **`/actuator/prometheus`** está permitido en el backend porque Prometheus lo lee directo de cada instancia por la red interna. Hacia afuera, el nginx del compose solo publica `/actuator/health` y cualquier otro `/actuator/...` responde 404 (T03).
3. Las pruebas que respaldan esta matriz están en `AccesoDenegadoRegistroHttpTest`, `SolicitudFlujoHttpTest`, `SolicitudLlegadaHttpTest`, `PosicionHttpTest`, `EmergenciaActualizacionHttpTest`, `RegistroAccesoDenegadoTest`, `StompAuthChannelInterceptorTest`, `RegistroHttpTest`, `RegistrarUsuarioUseCaseImplTest`, `ResolutorSesionFirebaseTest` y `ValidadorTokenFirebaseTest` (este último incluye la medición del p95 de la validación del token, menor a 50 ms).

## 4. Registro y roles

- Todo usuario nuevo entra con su cuenta de Google y elige su rol al registrarse (`POST /registros`).
- Los roles que se pueden elegir son **ciudadano**, **administrador de centro** (se guarda como `ADMIN_CENTRO_AYUDA`; centro de ayuda y de acopio son lo mismo) y **conductor**.
- **ADMIN_PLATAFORMA** y **ADMIN_ACOPIO** nunca se pueden elegir al registrarse. El administrador de plataforma está precargado y se enlaza con su cuenta de Google.
- El nombre y el correo salen del token de Google, no de lo que envía el cliente.
- El conductor indica además **placa y modelo** del vehículo. La placa debe ser única: si ya existe, el registro responde 409.
- Al registrarse, la persona crea también una **contraseña** (mínimo 8 caracteres, con mayúscula, minúscula y número; el símbolo no es obligatorio). La contraseña se guarda en **Firebase**, enlazada a la misma cuenta de Google, nunca en NexoVital: después puede entrar con su correo y contraseña o con Google, y en los dos casos es el mismo usuario.

## 5. Registro de los rechazos (T11)

Cada rechazo deja una línea en el log con la hora, sin el token:

| Rechazo | Línea |
|---|---|
| 401 por HTTP | `autenticacion_fallida canal=http metodo=… ruta=… ip=… motivo=token_ausente\|token_invalido\|usuario_no_registrado` |
| 401 en el WebSocket | `autenticacion_fallida canal=stomp motivo=token_ausente\|token_invalido\|usuario_no_registrado\|sesion_no_autenticada` |
| 403 | `acceso_denegado actor=<id> rol=<rol> metodo=… ruta=… ip=… motivo=rol_insuficiente\|recurso_ajeno` |
| 403 al registrarse | `acceso_denegado actor=google:<uid> rol=- metodo=POST ruta=/api/v1/registros ip=… motivo=rol_no_elegible` |
