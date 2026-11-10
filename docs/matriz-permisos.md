# Matriz de permisos por rol y por recurso (EP-06.F2.US1 · T09)

Escenario de calidad **S-4**: el backend verifica el rol y la pertenencia del recurso en cada solicitud, rechaza con **403** y registra el intento. Los intentos sin sesión válida (**S-1**) se rechazan con **401** y también se registran.

## 1. Cómo se decide

| Paso | Dónde | Resultado si falla | Registro en el log |
|---|---|---|---|
| 1. ¿Hay token válido? | `JwtAuthFilter` + `SecurityConfig` (entry point) | 401 `NO_AUTENTICADO` | `autenticacion_fallida canal=http motivo=token_ausente\|token_invalido` |
| 1b. ¿El CONNECT del WebSocket trae un token válido? | `StompAuthChannelInterceptor` | No se abre la conexión | `autenticacion_fallida canal=stomp motivo=...` |
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
| `PATCH /emergencias/{id}` | ❌ | ❌ | ❌ | ✅ | ❌ | Ninguna: cualquier ACY puede actualizar cualquier emergencia (ver nota 1) |
| `POST /organizaciones` | ❌ | ❌ | ❌ | ❌ | ✅ | — |
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
| `GET /auditoria/**` | ❌ | ❌ | ❌ | ❌ | ✅ | — |
| Canal en tiempo real (`/ws`, CONNECT y SUBSCRIBE) | ✅ | ✅ | ✅ | ✅ | ✅ | Requiere token válido en el CONNECT. Los clientes no pueden publicar en `/topic` ni en `/queue` |
| `/actuator/health`, `POST /sesiones` (login local de desarrollo) | público | | | | | — |

Todas las rutas van con el prefijo `/api/v1`, salvo `/ws` y `/actuator`.

## 3. Notas

1. **`PATCH /emergencias/{id}`** no tiene regla de pertenencia: cualquier admin de un centro de ayuda puede actualizar cualquier emergencia. Si el equipo decide que solo el centro que atiende la emergencia puede cambiarla, eso es una regla nueva y queda fuera de esta corrección.
2. **`/actuator/prometheus`** está permitido en el backend porque Prometheus lo lee directo de cada instancia por la red interna. Hacia afuera, el nginx del compose solo publica `/actuator/health` y cualquier otro `/actuator/...` responde 404 (T03).
3. Las pruebas que respaldan esta matriz están en `AccesoDenegadoRegistroHttpTest`, `SolicitudFlujoHttpTest`, `SolicitudLlegadaHttpTest`, `PosicionHttpTest`, `RegistroAccesoDenegadoTest` y `StompAuthChannelInterceptorTest`.
