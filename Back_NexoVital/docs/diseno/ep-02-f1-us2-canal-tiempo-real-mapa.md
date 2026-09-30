# Diseño — Canal de tiempo real del mapa (WebSocket/STOMP)

**Historia:** `EP-02.F1.US2` Recibir alertas del mapa en tiempo real · **Tarea Azure DevOps:** `244` (Design, 3 h)
**Rama:** `EP-02.F1.US1` · **Repositorio:** `Nexo-Vital/Back_NexoVital` · **Sprint:** `Nexo_Vital\Sprint 1`
**Estado:** propuesto, pendiente de revisión del equipo
**Tareas que consumen este diseño:** implementación del canal (WebSocketConfig + interceptor), los productores de eventos de US3/US4/US5 (reportar/actualizar/eliminar elemento), la suscripción del front y las pruebas de dos sesiones.
**Ámbito:** solo diseño. No se escribe código de producción en esta tarea.

> **Convención de lectura.** **`NUEVO`** = nombre o archivo que este diseño introduce y que hoy **no existe** en el repositorio. **`REFERENCIA`** = comportamiento ya probado en la implementación de referencia (`arws-inception/backend/`, ver §2.3). **`NO ENCONTRADO`** = algo que este diseño necesitaba y que **no existe** ni en el contrato ni en el front ni en el back; se propone como **decisión explícita**, nunca se asume como existente.

---

## 1. Objetivo y alcance

La historia exige que, cuando **aparece o cambia un elemento relevante del mapa**, todos los clientes conectados lo vean **sin recargar** y **en menos de 1 s**, con el elemento **resaltado en azul** (`historias-de-usuario.md:193`). El ciudadano que se conecta tarde debe ver el estado vigente (`historias-de-usuario.md:195`).

Esta tarea diseña **el canal** (protocolo, endpoint, destinos, eventos, payloads, emisor, autorización), no los casos de uso que producen las mutaciones. La descripción de la tarea 244 lo fija: *"Definir el protocolo de conexión persistente y los eventos que se propagan (crear/editar elemento)"*.

| Dentro del alcance (244) | Fuera del alcance (otras tareas / historias) |
|---|---|
| Protocolo y endpoint del canal | Los casos de uso que mutan el mapa (US3/US4/US5) |
| Destinos (tópicos/colas) y su reconciliación con el front | La UI del resaltado azul y el detalle del evento |
| Catálogo de eventos y payloads | El semáforo de recursos (EP-02.F2, EP-03) |
| Quién emite (módulo dueño vs. gateway) | El broadcast de C2 (`/queue/solicitudes`) |
| Post-commit y alcance del outbox | El outbox transaccional con broker (tarea aparte) |
| Autorización del WebSocket | El resume/replay por `seq` de `system-design/09` §2.8 |
| Prueba con dos sesiones simultáneas | Correo, SMS o push (fuera de la historia, `historias-de-usuario-realtime.md:119`) |

**No** se rediseña el canal de C2 (`/queue/solicitudes`) ni el de flota/suministros: se reutilizan tal como el contrato los fija.

---

## 2. Punto de partida

### 2.1 Lo que el repositorio trae hoy

| Elemento | Estado | Evidencia |
|---|---|---|
| `spring-boot-starter-websocket` | **CONFIGURADO** | `pom.xml:38-41` |
| `spring-boot-starter-amqp` | **CONFIGURADO** | `pom.xml:46-49` |
| Módulo `gateway` (realtime) | Andamiaje **vacío** (solo `.gitkeep`) | `src/main/java/.../gateway/` |
| Módulo `mapa` (zonas + centros por puerto) | Implementado (read-model) | `mapa/domain/model/`, `mapa/infrastructure/` |
| `GET /api/v1/mapa` (zonas y centros) | Implementado (tarea 241, cerrada) | `MapaController.java:37-45` |
| `GET /api/v1/organizaciones` | Implementado | `OrganizacionController.java:45-58` |
| `POST /api/v1/organizaciones` | **NO ENCONTRADO** en el back (solo en el contrato, `openapi.yaml:111-155`) | `OrganizacionController` solo tiene `GET` |
| `SecurityConfig` fail-closed | **CONFIGURADO** (`anyRequest().denyAll()`) | `SecurityConfig.java:57-76` |
| `@EnableMethodSecurity` | **NO ENCONTRADO** | grep en `src/main/java` sin coincidencias |
| `@EnableWebSocketMessageBroker` / `SimpMessagingTemplate` | **NO ENCONTRADO** | grep en `src/main/java` sin coincidencias |
| `JwtAuthFilter` | **CONFIGURADO** (filtro servlet, `OncePerRequestFilter`) | `JwtAuthFilter.java:26-63` |
| `AuthenticationUseCase.validarToken` | **CONFIGURADO** (reutilizable) | `AuthenticationUseCase.java:29` |
| `DataSeeder` (zonas con contorno y centros) | **CONFIGURADO** | `DataSeeder.java:119-164` |
| Suscripción realtime del mapa en el front | **NO ENCONTRADA** (el mapa hoy solo hace REST) | `use-map-data.ts:32-54` |

### 2.2 Lo que NO existe todavía

- No hay ningún adaptador de entrada WebSocket/STOMP en el back, ni broker simple, ni publicador STOMP.
- No hay mutaciones de elementos del mapa: `mapa` solo lee. Los productores llegan con US3/US4/US5.
- No hay tabla de outbox ni relay; el perfil por defecto (H2) **no tiene broker** (la topología Rabbit es `@Profile("docker")`, `REFERENCIA` `RabbitTopologyConfig.java:40`).
- El front **no se suscribe** a ningún evento de mapa; `use-map-data.ts` solo llama `GET /api/v1/mapa`.

### 2.3 Implementación de referencia (`REFERENCIA`)

Entrega previa funcional en `arws-inception/backend/` (mismo `pom.xml`). Rutas relativas a `arws-inception/backend/`.

| Elemento de referencia | Ruta | ¿Se porta? |
|---|---|---|
| `WebSocketConfig` (STOMP `/ws` + SockJS, broker simple `/topic` `/queue`, prefijo `/app`) | `src/main/java/.../infrastructure/config/WebSocketConfig.java:16-32` | **Sí, con cambios** (§10) |
| `RabbitTopologyConfig` (exchange `nexovital.events`, fanout `ws.push`, cola `ws.push.gateway`, DLQ) | `src/main/java/.../infrastructure/config/RabbitTopologyConfig.java` | **Sí, diferido** al perfil `docker` (§10) |
| `StompEventPublisher` (gateway que escucha DomainEvents y publica STOMP) | `src/main/java/.../gateway/infrastructure/adapter/out/StompEventPublisher.java` | **No** (§10, contradice Modelo Y) |
| `SecurityConfig` que permite `/ws/**` | `src/main/java/.../infrastructure/config/SecurityConfig.java:43` | **Sí, con un añadido obligatorio** (§10) |

### 2.4 El canal que el front YA tiene funcionando (pieza central de este diseño)

El front tiene **dos transportes** y una abstracción que los separa:

| Pieza | Qué es | Ruta |
|---|---|---|
| `RealtimePort` | Interfaz única (`connect/publish/subscribe/onStateChange`) de la que dependen **todas** las features | `src/shared/realtime/port.ts:15-27` |
| `DevRelayAdapter` | WebSocket **crudo** a `ws(s)://<host>/realtime`, envelope JSON `{destination, payload}`, **solo broadcast** | `src/shared/realtime/dev-relay-adapter.ts` |
| `REALTIME_PATH = '/realtime'` | Ruta del relay crudo | `src/shared/realtime/messages.ts:32` |
| `DESTINATIONS` | Los 4 destinos que el front conoce | `src/shared/realtime/messages.ts:18-23` |
| Relay de dev | Plugin de Vite que monta el WebSocketServer en `/realtime` (solo `apply: 'serve'`) | `vite-plugin-dev-realtime.ts` |
| Relay de demo | Durable Object `RealtimeRoom` en el mismo Worker, mismo path y protocolo | `worker/realtime-room.ts`, `worker/index.ts:15-19` |
| `stompClient.ts` | Cliente STOMP **ya escrito** a `/ws` con SockJS y `Authorization: Bearer`, **sin cablear** | `src/services/stompClient.ts:19-40` |
| Punto de cambio | `getRealtimePort()` devuelve `DevRelayAdapter` con un **TODO explícito** de sustituirlo por el adapter STOMP | `src/shared/realtime/index.ts:13-22` |

`DESTINATIONS` del front (`messages.ts:18-23`): `/topic/flota`, `/topic/emergencias`, `/topic/suministros`, `/queue/solicitudes`. **No hay destino de mapa.** Los consumidores realtime existentes son `use-fleet-sync.ts:83` (flota), `use-emergency-sync.ts:44` (emergencias), `use-solicitud-inbox.ts:125` (solicitudes). El mapa (`use-map-data.ts`) no consume realtime.

### 2.5 Contradicciones detectadas (se declaran, no se tapan)

1. **Contrato vs. system-design (destinos del gateway).** `system-design/09` §2.8 y `system-design/10` §4 dicen que el gateway escribe en `/topic/map.events`, `/topic/dispatch.offers`, `/topic/alerts`. El **contrato** (`contract/README.md:14-20`) fija `/topic/emergencias/{id}`, `/topic/emergencias`, `/topic/flota`, `/topic/suministros`, `/queue/solicitudes`. **Son dos juegos de nombres distintos.** Para el destino del mapa este diseño adopta el nombre **ya declarado** en el system-design (`/topic/map.events`, `system-design/10-organizacion-modular-hexagonal.md:147`) y conserva los cuatro destinos del contrato para el resto; el desalineamiento con el contrato queda declarado como riesgo **R3**.
2. **Referencia vs. ADR (Modelo Y).** El `StompEventPublisher` de la referencia vive en `gateway/` y **importa eventos de dominio** (`flota.domain.event.*`, `recursos.domain.event.*`) — es un gateway integrador, que el ADR-0003 prohíbe explícitamente (*"el `gateway` consume **solo** el exchange fanout interno `ws.push` — nunca eventos de dominio"*, `ADR-0003:55-56`). El diseño **no porta esa forma** (§D5, §10).
3. **Referencia: STOMP sin autenticación real.** La referencia permite `/ws/**` (`SecurityConfig.java:43`) y el front manda el token en `connectHeaders` (`stompClient.ts:22-24`), pero **no hay `ChannelInterceptor`** que valide ese token (grep sin coincidencias). En la práctica el canal STOMP de la referencia queda **abierto**. Este diseño **no porta ese hueco** (§D7).
4. **Rama vs. historia.** La tarea 244 cuelga de la historia **EP-02.F1.US2** (Azure 183), pero la rama de trabajo es `EP-02.F1.US1`. Ver riesgo **R7**.

---

## 3. Decisiones de diseño

### D1 — El canal es WebSocket/STOMP en `/ws` (con SockJS), el que el contrato y el front ya conocen

- **Decisión:** el back termina **STOMP sobre WebSocket** en el endpoint `/ws` (`NUEVO` en este repositorio), con **fallback SockJS**, broker simple sobre `/topic` y `/queue`, y prefijo de aplicación `/app`. Es exactamente el `WebSocketConfig` de la `REFERENCIA` (`WebSocketConfig.java:21-31`).
- **Por qué:** (a) es el contrato del proyecto — `contract/README.md:10` *"STOMP NO va en OpenAPI … el contrato hablado entre frontend y backend para STOMP es este documento"*, y `:52` *"STOMP: mismo token JWT en el handshake"*; (b) el front ya tiene el cliente escrito (`stompClient.ts`); (c) el proxy de Vite ya enruta `/ws` → `ws://localhost:8080` (`vite.config.ts`, sección `server.proxy`).
- **Rechazado:** un endpoint nuevo distinto de `/ws`. Rompería el contrato y el proxy ya existente sin beneficio.

### D2 — Reconciliación del canal del front: STOMP es el transporte de producción; el relay crudo `/realtime` queda solo para dev y demo. **Es la decisión más importante.**

- **Situación:** el front habla hoy un **WebSocket crudo** en `/realtime` con envelope `{destination, payload}` (`dev-relay-adapter.ts:7-9`), servido en dev por el plugin de Vite y en el deploy de demo por el Durable Object. El back habla **STOMP** en `/ws`. **No son el mismo canal.**
- **Decisión:**
  1. El back **no** implementa el protocolo crudo de `/realtime`. Adopta STOMP en `/ws` como **único canal de producción**.
  2. En el front se crea un adapter `StompRealtimeAdapter` (**NUEVO**) que implementa `RealtimePort` sobre el `stompClient.ts` que **ya existe**.
  3. El swap ocurre en **un solo archivo**: `getRealtimePort()` (`index.ts:13-22`) — el TODO que el propio front dejó escrito. Con el backend presente devuelve el adapter STOMP; en modo demo (`VITE_DEMO_MODE=1`) sigue devolviendo `DevRelayAdapter`.
  4. El **envelope `{destination, payload}` se preserva en el borde de `RealtimePort`**: `subscribe(destination, handler)` → `SUBSCRIBE` STOMP a ese destino; el **cuerpo del frame** es el `payload`; el adapter reconstruye el envelope para el handler. Así **ninguna feature cambia**: `use-fleet-sync`, `use-emergency-sync`, `use-solicitud-inbox` siguen dependiendo solo de `RealtimePort` y `DESTINATIONS`.
- **¿Es el mismo?** No. **¿Cambia el front?** Sí, en tres puntos acotados: el swap en `getRealtimePort` (un archivo), la suscripción del mapa (D8, que hoy no existe) y —fuera del alcance de esta tarea— el mapeo de `publish` a `/app/*` para C2 (riesgo **R2**). **¿Conviven?** Sí: `/realtime` sobrevive como transporte de **dev** (plugin Vite) y de **demo** (Durable Object); `/ws` es el de producción con backend.
- **Por qué no arrancar de cero:** el front ya resolvió el problema difícil — una abstracción de transporte y un cliente STOMP probado. El diseño lo **reconcilia** en vez de inventar un protocolo nuevo.
- **Por qué no usar `/realtime` como canal de producción:** es un relay de reenvío sin autenticación, no es el contrato, y obligaría a mantener dos protocolos en paralelo. Se descarta (§D10).

### D3 — Destinos: se reutilizan los cuatro del contrato y se adopta el destino de mapa ya declarado en el system-design, `/topic/map.events`

- **Decisión:** el mapa se alimenta de los cuatro destinos que **ya existen** en el contrato más el destino de mapa que **ya declara el system-design** para el ciclo de vida de los elementos del mapa:

| Destino | Estado | Qué transporta | Quién lo consume |
|---|---|---|---|
| `/topic/emergencias` | **YA DEFINIDO** (`contract/README.md:17`, `messages.ts:20`) | Nueva emergencia reportada | Mapa (todos los roles) |
| `/topic/emergencias/{id}` | **YA DEFINIDO** (`contract/README.md:16`) | Emergencia actualizada | Mapa + detalle |
| `/topic/flota` | **YA DEFINIDO** (`contract/README.md:18`, `messages.ts:19`) | Posición y estado de ambulancias | Mapa + panel de flota |
| `/topic/suministros` | **YA DEFINIDO** (`contract/README.md:19`, `messages.ts:21`) | Inventario y semáforo R/A/V | Mapa + inventario |
| **`/topic/map.events`** | **YA DEFINIDO** en el system-design (`system-design/10-organizacion-modular-hexagonal.md:147`; `system-design/09-organizacion-microservicios-corregida.md:272`); **no** figura en el contrato ni en el front | Ciclo de vida de zonas y centros | Mapa (todos los roles) |

- **Por qué un destino propio y no reutilizar `/topic/emergencias`:** una **zona afectada** (US3) y un **centro** (organización) no son una emergencia. Meterlos en `/topic/emergencias` mentiría sobre el tipo de entidad y ensuciaría un canal que el contrato reserva a emergencias. Un destino propio por **clase de elemento del mapa** es lo que el system-design ya declara (un canal de mapa).
- **Por qué el nombre `/topic/map.events`:** el nombre **no se elige aquí**: ya está declarado en el system-design del proyecto — `system-design/10-organizacion-modular-hexagonal.md:147` y `system-design/09-organizacion-microservicios-corregida.md:272` listan `/topic/map.events` como destino del gateway. La regla del proyecto es **no inventar nombres**: se toma el que ya existe. El contrato (`contract/README.md:14-20`) aún no lo lista; el desalineamiento queda declarado en **R3**.
- **Brecha de implementación en el front:** el destino ya está declarado en el system-design (cita arriba), pero **no** figura en `DESTINATIONS` del front (`messages.ts:18-23`); debe añadirse para que el mapa se suscriba.

### D4 — Catálogo de eventos del mapa y sus payloads

- **Decisión:** en `/topic/map.events` viaja un envelope `{destination, payload}` donde `payload` es una unión discriminada por `type` (misma convención que `FleetPayload` y `EmergencyUpsertPayload` del front, `messages.ts:56-82`):

```jsonc
// elemento creado o actualizado — el consumidor hace UPSERT
{
  "destination": "/topic/map.events",
  "payload": {
    "type": "mapa.elemento.upsert",
    "elemento": {
      "clase": "ZONA",              // "ZONA" | "CENTRO"
      "id": "Suba",                 // id de la zona, o UUID del centro
      "nombre": "Suba",
      "ubicacion": { "lat": 4.73, "lng": -74.08 },
      "contorno": [ { "lat": 4.79, "lng": -74.10 }, /* … */ ],  // solo ZONA
      "zonaId": "Suba",             // solo CENTRO
      "tipo": "CENTRO_ACOPIO"       // solo CENTRO
    }
  }
}

// elemento eliminado — el consumidor lo quita
{
  "destination": "/topic/map.events",
  "payload": { "type": "mapa.elemento.delete", "clase": "ZONA", "id": "Suba" }
}
```

- **Regla UPSERT (idéntica a flota/emergencias):** un `id` desconocido se **crea**, uno conocido se **fusiona**. El `delete` lo retira. Es la misma semántica que el front ya implementa para `fleet.upsert`/`fleet.delete` (`messages.ts:52-65`).
- **Cuándo se emite:** al **crear, editar o eliminar** un elemento del mapa (US3/US4/US5). En los tres casos el evento se emite **post-commit** (D6).
- **Payload del elemento:** reutiliza la forma que el mapa ya sirve por REST — `ZonaDto` (`ZonaDto.java:13`) y `CentroDto` — para que el front pueda **reutilizar el mismo mapper** que ya usa en `mapaToCentros` (`map-api.ts:40-48`) y en el pintado del contorno.
- **Rechazado:** un evento por campo/cambio (`zona.nombre.cambiado`, etc.). Es un catálogo abierto e inmanejable; el upsert completo del elemento es idempotente y basta.

### D5 — Quién emite: el **módulo dueño del dato**, no el gateway (Modelo Y del ADR-0003)

- **Decisión:**
  - El módulo **`mapa`** es dueño de las **zonas** → emite los eventos de zona.
  - El módulo **`usuarios`** es dueño de las **organizaciones/centros** → emite los eventos de centro (el catálogo de `REFERENCIA` ya define `organization.registered`, `organization.updated`, `organization.active`, `organization.inactive`, `RabbitTopologyConfig.java:57-60`).
  - El módulo dueño **proyecta** el evento y publica el **payload de push ya armado** (`{destination, payload}`) al exchange fanout `ws.push`.
  - El **`gateway`** consume **solo** `ws.push` (cola `ws.push.gateway`, `RabbitTopologyConfig.java:47`) y hace **fan-out** a las sesiones STOMP de `/topic/map.events`. **Nunca conoce eventos de dominio.**
- **Por qué:** es literalmente el Modelo Y del ADR-0003 (`ADR-0003:55-58`) y de `system-design/10` §4 (`:146-151`): *"el `gateway` consume **solo** el exchange fanout interno `ws.push` … nunca consume eventos de dominio"*. Mantener al gateway como tubo tonto es lo que hace defendible la frontera (SOA).
- **Contradicción declarada:** la `REFERENCIA` hace lo contrario (`StompEventPublisher` en `gateway/` importando eventos de dominio). Este diseño **no la sigue**; ver §2.5 y §10.
- **Consecuencia para el MVP sin broker:** como el deployable es **uno solo** (`ADR-0003:39`), el "publicar a `ws.push`" se resuelve en proceso con un puerto de salida `PushPort` (**`NUEVO`**): en el MVP su adaptador publica un evento de aplicación que el componente del gateway reenvía a `SimpMessagingTemplate`; en el destino publica al exchange `ws.push` por AMQP. El gateway **solo ve `{destination, payload}`**, nunca un tipo de dominio — el Modelo Y se preserva en ambos modos.

### D6 — Post-commit obligatorio; el outbox transaccional es el destino y **se posterga**

- **Decisión:** ningún evento se publica dentro de la transacción ni antes de que el cambio sea durable. En el MVP se garantiza con `@TransactionalEventListener(phase = AFTER_COMMIT)` (**el idioma de la `REFERENCIA`**, `StompEventPublisher.java:52`), dentro del **módulo dueño** (no en el gateway).
- **Por qué ya:** es la regla de oro del contrato — *"publish POST-COMMIT (outbox)"* (`contract/README.md:22-29`) y la regla 2 del `backend/README.md`. Un publish intra-transacción expone al consumidor eventos que la BD puede no haber confirmado.
- **Qué se posterga y por qué:** el **transactional outbox** con tabla `event_outbox` por esquema + relay por módulo + broker RabbitMQ (`system-design/10` §3, `:99-103`) **no** entra en esta tarea. Motivo: con **un solo deployable** (`ADR-0003:39`), el listener `AFTER_COMMIT` en proceso es equivalente para el MVP; el outbox existe para sobrevivir a la caída del broker y a la propagación entre servicios, que en el monolito aún no ocurre. El diseño fija el **invariante** (post-commit) y el **contrato** (destinos/payloads); el outbox es una mejora mecánica posterior.
- **Lo que NO se puede postergar:** publicar antes del commit. Eso queda prohibido desde ya.

### D7 — Autorización: handshake permitido en HTTP, CONNECT autenticado por un `ChannelInterceptor`; **sin `@PreAuthorize`**

- **Problema:** el `SecurityConfig` es **fail-closed** (`anyRequest().denyAll()`, `SecurityConfig.java:76`). El handshake STOMP llega por HTTP a `/ws/**`, así que **hoy sería denegado**. Y el repo **no tiene `@EnableMethodSecurity`** (grep sin coincidencias), por lo que **`@PreAuthorize` no se evalúa**: la autorización no puede delegarse a anotaciones.
- **Decisión:**
  1. Añadir `.requestMatchers("/ws/**").permitAll()` en `SecurityConfig` (igual que la `REFERENCIA`, `SecurityConfig.java:43`), porque el handshake HTTP **no lleva el Bearer** (el token viaja en el frame STOMP `CONNECT`) y SockJS hace `GET /ws/info` por HTTP.
  2. Permitir el handshake **no es autenticar**. Añadir un **`ChannelInterceptor` `NUEVO`** en el canal de entrada STOMP (`configureClientInboundChannel`) que:
     - en `CONNECT`: lee `Authorization: Bearer <jwt>` de las cabeceras STOMP, valida con el `AuthenticationUseCase.validarToken` **ya existente** (`AuthenticationUseCase.java:29`, la misma lógica que usa `JwtAuthFilter.java:45`), publica el `Principal` y las autoridades `ROLE_<ROL>` en la sesión STOMP, y **rechaza el CONNECT** si el token falta o es inválido.
     - en `SUBSCRIBE`: exige sesión autenticada. Suscribirse a `/topic/map.events` es de **todo rol autenticado**, espejo de `GET /api/v1/mapa` que hoy es `.authenticated()` (`SecurityConfig.java:71`).
  3. **No** usar `@PreAuthorize` (no se evalúa). Toda autorización vive en `SecurityConfig` (HTTP) + el interceptor (STOMP).
- **Por qué no reutilizar `JwtAuthFilter` directo:** es un `OncePerRequestFilter` servlet; los frames STOMP **no** son peticiones HTTP y el filtro **nunca corre** para ellos. Se reutiliza la **lógica de validación**, no el filtro.
- **Hueco de la `REFERENCIA` que NO se porta:** la referencia permite `/ws/**` y lee `connectHeaders.Authorization` pero **no tiene interceptor**, así que su canal queda sin autenticar (§2.5). Este diseño cierra ese hueco.

### D8 — Cómo se suscribe el frontend y actualiza el mapa sin recargar

- **Decisión:**
  1. `use-map-data.ts` (**hoy solo REST**, `use-map-data.ts:32-54`) conserva el `GET /api/v1/mapa` como **snapshot** inicial (tarea 241) y **añade** una suscripción realtime vía `getRealtimePort().subscribe(DESTINATIONS.mapa, handler)`.
  2. El handler hace **UPSERT** en el estado local: `mapa.elemento.upsert` crea o fusiona la zona/centro; `mapa.elemento.delete` lo quita. Reutiliza los mappers existentes (`mapaToCentros`, `map-api.ts:40-48`).
  3. El **resaltado azul** es un flag de UI de vida corta, indexado por `id` de elemento, que el handler enciende al recibir el evento y apaga por temporizador. **No** es parte del contrato de datos.
  4. **Ciudadano que llega tarde** (`historias-de-usuario.md:195`): el snapshot REST le da el estado vigente y el stream le da los deltas posteriores.
- **`NO ENCONTRADO` / brecha declarada:** el MVP **no** implementa el resume/replay por `seq` ni el buffer acotado del `system-design/09` §2.8 (`:277-297`). Entre el snapshot REST y el `SUBSCRIBE` existe una **ventana pequeña** en la que un evento podría perderse. Queda como riesgo **R5** y trabajo futuro; para el MVP la ventana es de milisegundos en red local.
- **Modo demo:** con `VITE_DEMO_MODE=1` el front sigue usando `DevRelayAdapter` y los fixtures; no cambia nada.

### D9 — Cómo se prueba con dos sesiones simultáneas

- **Decisión:** prueba de integración con **servidor real** (no MockMvc, que no tiene WebSocket):
  1. `@SpringBootTest(webEnvironment = RANDOM_PORT)` + `@ActiveProfiles("test")`.
  2. Obtener **dos** tokens reales vía `POST /api/v1/sesiones` (patrón de `LoginTestBase.java:57-62`) con **dos usuarios distintos** del catálogo sembrado (`DataSeeder.java:70-80`).
  3. Abrir **dos** `WebSocketStompClient` (SockJS o WS nativo), ambos con `connectHeaders = { Authorization: Bearer <token> }`, ambos suscritos a `/topic/map.events`.
  4. Disparar la mutación (p. ej. `POST` del elemento). Afirmar que **ambos** reciben el frame.
  5. Medir la latencia entre el commit y la recepción; afirmar **< 1 s** (criterio de `historias-de-usuario.md:193`).
  6. Casos negativos: `CONNECT` **sin** token → rechazado (D7); `SUBSCRIBE` sin sesión → rechazado.
  7. Ciudadano tardío: suscribir **después** de la mutación y verificar que el snapshot REST trae el elemento.
- **Por qué dos sesiones reales:** el criterio de aceptación de la historia es explícitamente "dos usuarios A y B conectados al mismo tiempo" (`historias-de-usuario.md:193`); un test de una sola sesión no lo prueba.

### D10 — Alternativas descartadas (tabla de decisión del proyecto)

Criterios tomados del propio proyecto: latencia ≤ 1 s en red local (`retos-concurrencia-v2.md:42`), bidireccionalidad (C2 necesita cliente→servidor, `contract/README.md:20`), contrato único STOMP (`contract/README.md:10`), autenticación por token, y "sin recargar" (`historias-de-usuario.md:193`).

| Criterio | Polling REST | SSE | WebSocket crudo `/realtime` en producción | **STOMP `/ws` (elegido)** |
|---|---|---|---|---|
| Latencia ≤ 1 s | ✗ (acotada por el intervalo) | ✓ | ✓ | ✓ |
| Bidireccional (C2) | ✓ (POST) | ✗ (solo servidor→cliente) | ✓ (pero relay sin árbitro real) | ✓ (`/app` + `/queue`) |
| Es el contrato del proyecto | ✗ | ✗ | ✗ | ✓ (`contract/README.md:10`) |
| Autenticación | ✓ (Bearer) | limitada | ✗ (relay sin auth) | ✓ (CONNECT + interceptor, D7) |
| Front ya lo tiene | parcial | ✗ | ✓ (dev/demo) | ✓ (`stompClient.ts`) |
| Coste/encaje | alto en carga | segundo mecanismo | duplica el broker | un solo canal |

- **Polling:** descartado por latencia y carga; incumple "sin recargar" y el ≤ 1 s. El propio proyecto lo deja solo como **plan B** ante fallo de WebSockets (riesgo T4, `NexoVital-Analisis-Financiero.md:300`).
- **SSE:** técnicamente válido para alertas de solo-lectura (`retos-concurrencia-v2.md:51` lo menciona), pero **no** cubre el broadcast de C2 (cliente→servidor) y **obligaría a un segundo mecanismo** realtime; el proyecto ya estandarizó STOMP y el front ya tiene el cliente. Se descarta por fragmentar el contrato.
- **WebSocket crudo `/realtime` como producción:** se descarta por no ser el contrato, no tener autenticación y duplicar el broker. Se **conserva** como transporte de dev/demo (D2).
- **Gateway consumidor de eventos de dominio (Modelo X):** descartado por el ADR-0003 (`:55-58`); ver D5.

### D11 — Ubicación de cada pieza en la arquitectura de este repositorio

| Capa | Componente | Estado |
|---|---|---|
| `infrastructure/config/` | `WebSocketConfig` (STOMP `/ws` + SockJS, broker `/topic` `/queue`, prefijo `/app`) | `NUEVO` |
| `infrastructure/config/` | `StompAuthChannelInterceptor` (valida CONNECT/SUBSCRIBE) | `NUEVO` |
| `infrastructure/config/` | `.requestMatchers("/ws/**").permitAll()` en `SecurityConfig` | MODIFICACIÓN |
| `gateway/infrastructure/adapter/out/` | Consumidor de `ws.push` → `SimpMessagingTemplate` (fan-out) | `NUEVO` |
| `mapa/domain/port/out/` | `PushPort` (publica `{destination, payload}` a `ws.push`) | `NUEVO` |
| `mapa/infrastructure/adapter/out/` | Adaptador del `PushPort` (MVP: evento en proceso; destino: AMQP) | `NUEVO` |
| `mapa/application/usecase/` | `CrearZona` / `ActualizarZona` / `EliminarZona` (emiten post-commit) | `NUEVO` (US3/US4/US5) |
| `usuarios/application/usecase/` | `CrearOrganizacion` / `ActualizarOrganizacion` (emiten post-commit) | `NUEVO` (`POST /organizaciones` hoy no implementado) |
| `infrastructure/config/` | `RabbitTopologyConfig` (perfil `docker`) | `NUEVO` (diferido, D6) |
| Front | `StompRealtimeAdapter` + swap en `getRealtimePort()` | `NUEVO` |
| Front | `DESTINATIONS.mapa = '/topic/map.events'` | `NUEVO` |
| Front | Suscripción del mapa en `use-map-data.ts` | `NUEVO` |

El flujo respeta la dirección de dependencias: `application/usecase` depende solo de `domain` (puertos); `infrastructure/adapter` implementa los puertos; el dominio no importa Spring, ni BD, ni STOMP (`backend/README.md:41-43`).

---

## 4. Contrato del canal

### 4.1 Endpoint y configuración

| Elemento | Valor | Origen |
|---|---|---|
| Endpoint | `/ws` | `REFERENCIA` `WebSocketConfig.java:22`; front `stompClient.ts:21` |
| Fallback | SockJS (`.withSockJS()`) | `REFERENCIA` `WebSocketConfig.java:24`; front `stompClient.ts:21` |
| Orígenes | `http://localhost:5173`, `http://127.0.0.1:5173` | `REFERENCIA` `WebSocketConfig.java:23`; `SecurityConfig.java:40-41` |
| Broker simple | `/topic`, `/queue` | `REFERENCIA` `WebSocketConfig.java:29` |
| Prefijo de aplicación | `/app` | `REFERENCIA` `WebSocketConfig.java:30` |
| Proxy de dev | `/ws` → `ws://localhost:8080` | `vite.config.ts` (`server.proxy`) |

### 4.2 Destinos del mapa

Ver tabla de **D3**. Los cuatro destinos existentes no cambian; el destino del mapa es `/topic/map.events`, ya declarado en el system-design (`system-design/10-organizacion-modular-hexagonal.md:147`).

### 4.3 Eventos y payloads

Ver **D4**. Envelope `{destination, payload}` con `payload.type ∈ {mapa.elemento.upsert, mapa.elemento.delete}`.

### 4.4 Diagrama del flujo (MVP, un solo deployable)

```
  HTTP POST/PATCH/DELETE (US3/US4/US5)
        │
        ▼
  ┌─────────────────────┐   misma transacción
  │ use case del módulo │───────────────►  BD (commit)
  │ dueño (mapa/usuarios)│
  └─────────┬───────────┘
            │ @TransactionalEventListener(AFTER_COMMIT)   ← D6
            ▼
  ┌─────────────────────┐
  │ PushPort            │  payload YA armado {destination, payload}
  └─────────┬───────────┘
            │ MVP: evento en proceso   ·   Destino: AMQP → ws.push (fanout)
            ▼
  ┌─────────────────────┐
  │ gateway: fan-out    │  NO conoce eventos de dominio (Modelo Y, D5)
  │ SimpMessagingTemplate│
  └─────────┬───────────┘
            │ STOMP
            ▼
      /topic/map.events  ──►  front: RealtimePort.subscribe → UPSERT + resaltado azul
```

---

## 5. Autorización (detalle)

| Punto | Regla | Dónde |
|---|---|---|
| Handshake HTTP `/ws/**` y `/ws/info` (SockJS) | `permitAll` | `SecurityConfig` (modificación) |
| Frame STOMP `CONNECT` | Exige `Authorization: Bearer <jwt>` válido; publica `Principal` + `ROLE_<ROL>`; si falta o es inválido, **rechaza** | `StompAuthChannelInterceptor` (`NUEVO`) |
| Frame STOMP `SUBSCRIBE /topic/map.events` | Exige sesión autenticada (todo rol) | `StompAuthChannelInterceptor` (`NUEVO`) |
| Validación del token | Reutiliza `AuthenticationUseCase.validarToken` | `AuthenticationUseCase.java:29` |
| `@PreAuthorize` | **No se usa** (no hay `@EnableMethodSecurity`) | — |

> El token de la sesión STOMP no se revalida en cada frame; la autoridad se fija en el `CONNECT`, igual que el `JwtAuthFilter` fija el contexto por petición HTTP. La expiración del JWT durante una sesión abierta **no** cierra la sesión (mismo criterio que el diseño de login D9, `ep-01-f1-us2-inicio-sesion.md:169-170`).

---

## 6. Post-commit y outbox

| Nivel | Qué exige | Estado |
|---|---|---|
| **Invariante (ya)** | Ningún publish antes del commit; se usa `@TransactionalEventListener(AFTER_COMMIT)` en el módulo dueño | Obligatorio (D6) |
| **MVP** | Publicación en proceso del payload a `ws.push` (sin broker) | Dentro del alcance |
| **Destino** | Tabla `event_outbox` por esquema + relay por módulo → `nexovital.events` → `ws.push` (fanout) → gateway | **Postergado** (D6, tarea aparte) |
| **Resiliencia destino** | At-least-once + dedup por `eventId` + retry/backoff + DLQ | **Postergado** |

---

## 7. Casos de prueba que debe ejecutar la implementación

| # | Caso | Resultado esperado |
|---|---|---|
| T1 | Dos sesiones autenticadas suscritas a `/topic/map.events`; una mutación (crear zona) | **Ambas** reciben `mapa.elemento.upsert`; latencia < 1 s |
| T2 | Editar un elemento existente | Ambas reciben `mapa.elemento.upsert` con los datos nuevos; el consumidor fusiona |
| T3 | Eliminar un elemento | Ambas reciben `mapa.elemento.delete`; el elemento desaparece |
| T4 | `CONNECT` **sin** token | El frame es rechazado; no se abre la sesión |
| T5 | `CONNECT` con token inválido | Rechazado |
| T6 | Ciudadano que se conecta **después** de la mutación | El snapshot `GET /api/v1/mapa` trae el elemento vigente |
| T7 | Un elemento creado en una sesión y editado en la otra | El estado final converge al mismo para ambos |
| T8 | Evento de centro (`usuarios`) | Llega a `/topic/map.events` con `clase: "CENTRO"` |

---

## 8. Qué se porta del repositorio de referencia (`arws-inception/backend/`)

| Pieza de referencia | Decisión | Detalle |
|---|---|---|
| `WebSocketConfig` (`/ws`, SockJS, broker `/topic` `/queue`, prefijo `/app`) | **SE PORTA con cambios** | Se porta la estructura; se le añade el `ChannelInterceptor` (D7) y se ajustan los destinos (el del mapa es `/topic/map.events`, ya declarado en el system-design). |
| `RabbitTopologyConfig` (exchange `nexovital.events`, fanout `ws.push`, cola `ws.push.gateway`, DLX/DLQ) | **SE PORTA, DIFERIDO** | Se conserva el diseño para el perfil `docker`; no entra en el MVP (D6). |
| `SecurityConfig` permitiendo `/ws/**` | **SE PORTA + AÑADIDO OBLIGATORIO** | Se porta el `permitAll`; se **añade** el interceptor que la referencia no tiene (D7). |
| `StompEventPublisher` (gateway que importa eventos de dominio) | **NO SE PORTA** | Contradice el Modelo Y del ADR-0003 (D5, §2.5). En su lugar, el módulo dueño publica el payload a `ws.push`. |
| Broker RabbitMQ / outbox / DLQ | **NO SE PORTA en el MVP** | Diferido (D6). |
| Pruebas de la referencia | **NO SE PORTAN** | La referencia no tiene ninguna prueba WebSocket/STOMP (solo `SolicitudFlowIntegrationTest` e `InventarioFlowIntegrationTest`, ambos HTTP); las de D9 son nuevas. |

---

## 9. Riesgos y decisiones abiertas

| # | Severidad | Riesgo | Propuesta |
|---|---|---|---|
| R1 | **Alta** | Los productores de eventos (US3/US4/US5) **no existen**; el canal se diseña sin quien lo alimente todavía | El contrato de D4 queda fijo; US3/US4/US5 lo consumen. La prueba T1 usa un productor de prueba hasta que US3 exista |
| R2 | Media | `RealtimePort.publish` del front no mapea directo a STOMP: en STOMP el cliente envía a `/app/*`, no al destino de suscripción (hoy el relay crudo publica al mismo destino) | El mapa es **solo lectura**, no afecta a US2. El mapeo a `/app/*` es requisito de C2 (`/queue/solicitudes`) y se resuelve en el adapter STOMP. **Fuera de esta tarea** |
| R3 | Media | El contrato (`contract/README.md:14-20`) no lista el destino de mapa que el system-design ya declara (`/topic/map.events`, `system-design/10-organizacion-modular-hexagonal.md:147`) | El diseño adopta el nombre ya declarado en el system-design; el front debe añadirlo a `DESTINATIONS` (`messages.ts:18-23`) |
| R4 | Media | `POST /organizaciones` existe en el contrato (`openapi.yaml:111-155`) pero **no** en el back | La creación de centros no puede emitir hasta implementarla (US aparte) |
| R5 | Media | Sin `seq`/replay ni buffer (D8): ventana entre snapshot REST y `SUBSCRIBE` | Aceptable en red local para el MVP; el resume por `seq` de `system-design/09` §2.8 es trabajo futuro |
| R6 | Media | La referencia deja el canal STOMP sin autenticar (D7) | **No se porta**; el interceptor es obligatorio en la implementación |
| R7 | Baja | La tarea 244 cuelga de **EP-02.F1.US2** pero la rama es `EP-02.F1.US1` | Confirmar con el equipo la rama correcta antes de implementar |
| R8 | Baja | Ediciones concurrentes del mismo elemento sin CRDT: last-write-wins | Aceptado para el corte (`retos-concurrencia-v2.md:201`); CRDT está fuera de alcance |
| R9 | Baja | El front en modo demo no usa el backend; el adapter STOMP no debe romper la demo | `getRealtimePort()` conserva `DevRelayAdapter` con `VITE_DEMO_MODE=1` (D2) |

---

## 10. Trazabilidad con los criterios de aceptación

| Escenario de `EP-02.F1.US2` (`historias-de-usuario.md:186-197`) | Elemento del diseño |
|---|---|
| **Dos usuarios A y B conectados; A crea/edita; B lo ve sin recargar en < 1 s, resaltado en azul** | D1 (canal), D2 (reconciliación), D3/D4 (destino y eventos), D8 (suscripción), D9 (prueba T1/T2) |
| **El elemento se destaca en azul** | D8 (flag de UI por id) |
| **Ciudadano que se conecta tarde ve las alertas activas** | D8 (snapshot REST + deltas), D9 (T6) |
| **Fuera de alcance: correo, SMS o push** | §1 (fuera de alcance) |
| Regla del ADR: el gateway solo consume `ws.push` | D5, §8 |

---

## 11. Entregables de la tarea 244

1. Este documento: protocolo, endpoint, destinos, eventos, payloads, emisor, post-commit, autorización y pruebas.
2. La reconciliación explícita del canal del front (`/realtime` crudo vs. STOMP `/ws`).
3. La tabla de decisión de D10 con las alternativas descartadas.
4. Los 8 casos de prueba de §7, como insumo de la implementación.

**No incluye:** código de producción, los casos de uso de US3/US4/US5, el outbox transaccional con broker, el resume por `seq`, ni la UI del resaltado.
