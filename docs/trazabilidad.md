# Trazabilidad de peticiones y acciones críticas

**Historia:** EP-06.F2.US2 — Consultar la trazabilidad de peticiones y acciones críticas (escenario S-2).
**Tareas:** T13 (diseño), T14 (registro), T15 (consulta), T16 (pruebas).

El profesor aprobó S-2 con una condición: **garantizar la trazabilidad en todas las peticiones, guardando como mínimo hora, IP, usuario, navegador y país**. NexoVital lo cumple con dos registros que se enlazan entre sí.

| Registro | Tabla | Qué guarda | Desde |
|---|---|---|---|
| Bitácora de peticiones | `auditoria_peticiones` | **Toda** petición HTTP, y del WebSocket el `CONNECT`, el `SUBSCRIBE`, el `DISCONNECT` y los rechazos | Sprint 2 (T13–T16) |
| Acciones críticas | `auditoria_eventos` | Reporte de emergencia, despacho y donación de insumos, asignación de ambulancia y finalización del servicio, con quién, qué recurso y qué cambió | Sprint 1 |

Las dos tablas comparten el `traceId` de la petición, que es la cabecera `X-Request-Id` que el servidor devuelve en cada respuesta y que aparece en todas las líneas de log.

## 1. Qué se guarda de cada petición

| Campo | Contenido |
|---|---|
| `ocurrido_en` | Hora de la petición. |
| `ip` | IP del cliente: la primera entrada de `X-Forwarded-For`, que escribe nginx con `$remote_addr`, o la de la conexión si no hay proxy delante. Es el mismo criterio que usan el límite de solicitudes y el registro de rechazos. |
| `pais` | Código ISO del país (`CO`, `US`…). Vale `LOCAL` para IP privadas (Docker, red local, `127.0.0.1`) y `DESCONOCIDO` si no se pudo resolver. |
| `usuario_id`, `usuario_rol`, `actor` | Usuario de NexoVital, su rol y su correo. `actor` vale `anonimo` sin sesión, o `google:<uid>` para una cuenta de Google que se está registrando. |
| `navegador` | `User-Agent`, hasta 300 caracteres. |
| `canal`, `metodo`, `ruta` | `HTTP` con el verbo y la URI sin query string, o `STOMP` con el comando y el destino. |
| `estado` | Código HTTP. En STOMP es 200 si se aceptó y 403 si se rechazó. |
| `duracion_ms` | Tiempo que tomó atender la petición (solo HTTP). |
| `detalle` | Motivo del rechazo: `token_ausente`, `token_invalido`, `usuario_no_registrado`, `rol_insuficiente`, `recurso_ajeno`, `rol_no_elegible`, `destino_no_permitido`… |
| `trace_id` | `X-Request-Id` de la petición. En STOMP es `stomp-<sesión>`, el mismo para toda la vida de una conexión. |
| `instancia` | Instancia del backend que atendió (`backend-1`, `backend-2`). |

**Qué queda fuera:**
- `/actuator/prometheus` y `/actuator/health`. Son el raspado de métricas y las sondas de la plataforma, no peticiones de usuarios. Se configura con `nexovital.bitacora.excluir`.
- Cada mensaje del WebSocket. Las posiciones de la flota generan miles por minuto; se decidió en equipo registrar solo lo que cambia quién escucha, más los rechazos.
- El token y el cuerpo de la petición, que nunca se escriben.

## 2. Cómo se registra sin frenar el API

```
petición ─► TraceIdFilter ─► BitacoraPeticionesFilter ─► Spring Security ─► controlador
                                   │ (al terminar, con el resultado)
                                   ▼
                             cola en memoria ──(cada 500 ms, hilo propio)──► país por IP ──► INSERT por lotes
```

1. `BitacoraPeticionesFilter` corre antes que Spring Security y la envuelve. Así ve también lo que la seguridad corta con 401 o 403.
2. `JwtAuthFilter` deja el usuario autenticado en un atributo de la petición, y `RegistroAccesoDenegado` deja ahí el motivo del rechazo. El filtro los lee al final, cuando el contexto de seguridad ya se limpió.
3. El hilo de la petición solo encola. El hilo `bitacora-escritor` vacía la cola cada 500 ms, resuelve el país y escribe con un único `INSERT` por lotes.
4. En el WebSocket, `BitacoraStompInterceptor` es el **primer** interceptor del canal de entrada. Spring le avisa el resultado de cada frame aunque la autenticación lo rechace. La IP y el navegador se toman del handshake HTTP y quedan en la sesión.

**Garantía del 100 %:**
- Si la cola se llena, la fila se escribe en el momento, en el hilo de la petición.
- Si la base falla al escribir un lote, cada fila queda en el log como `bitacora_respaldo`, con todos sus campos.
- En un apagado ordenado, la cola se vacía antes de cerrar la conexión a la base.

Lo único no cubierto es que el proceso muera de golpe: se perderían como máximo los últimos 500 ms.

## 3. País de la IP

Se usa la base **GeoLite2-Country** de MaxMind, leída con un lector propio del formato `.mmdb` (`LectorMmdb`). No se agrega ninguna dependencia nueva.

- Ruta del archivo: variable `NEXOVITAL_GEOIP_RUTA`.
- Sin archivo, la aplicación arranca igual y el país queda `DESCONOCIDO`.
- El archivo real **no se versiona**, porque la licencia de GeoLite2 no permite redistribuirlo (`.gitignore`: `GeoLite2-*.mmdb`).
- Las pruebas usan bases con datos inventados, en `src/test/resources/geoip`.

## 4. Consulta (T15)

`GET /api/v1/auditoria/peticiones` está reservado al administrador de plataforma: sin token responde 401 y con cualquier otro rol, 403. Devuelve lo más reciente primero, 100 filas por defecto y 1000 como máximo.

| Parámetro | Para qué |
|---|---|
| `traceId` | Una petición concreta (el `X-Request-Id` que vio el cliente o que aparece en un log). |
| `usuarioId` | Todo lo que hizo un usuario. |
| `emergenciaId` / `centroId` | Las peticiones cuya ruta lleva ese id **y** las que originaron una acción crítica sobre él. Por ejemplo, el `POST /emergencias` que creó la emergencia, cuya ruta no tiene el id. |
| `desde`, `hasta` | Ventana de tiempo, en ISO-8601 (`2026-11-17T14:00:00Z`). |
| `limite` | Máximo de filas. |

Las consultas de acciones críticas siguen en `GET /auditoria/emergencias/{id}` y `GET /auditoria/centros/{id}`, y ahora cada evento trae su `traceId`.

## 5. Inmutabilidad

- No hay `POST`, `PUT`, `PATCH` ni `DELETE` sobre la bitácora; la cadena de seguridad niega todo lo no declarado.
- El puerto solo tiene `registrar` y `buscar`.
- Las entidades son `@Immutable` y no tienen setters, así que Hibernate ignora cualquier cambio.

## 6. Pruebas (T16)

| Prueba | Qué demuestra |
|---|---|
| `BitacoraPeticionesHttpTest` | 401 anónimo con IP real, país, navegador y motivo; usuario y rol en una petición autenticada; 403 con su motivo; rutas excluidas; **200 peticiones concurrentes → 200 filas, ninguna repetida**; 5000 registros en menos de 1 s sin tocar la base; consulta por `traceId`, usuario, centro y emergencia; sin escritura por la API ni por JPA. |
| `BitacoraStompRealTest` | Servidor real y cliente SockJS: CONNECT y SUBSCRIBE válidos registrados con usuario, IP y navegador; CONNECT sin token registrado como 403 `token_ausente`. |
| `BitacoraStompInterceptorTest` | Qué frames STOMP se registran y cuáles no. |
| `LectorMmdbTest` | País en los tres formatos del árbol (24, 28 y 32 bits), en IPv4 e IPv6, IP locales, sin base y entradas raras. |
| `ConsultarBitacoraUseCaseImplTest` | Límite entre 1 y 1000. |
