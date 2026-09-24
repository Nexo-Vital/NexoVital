# Diseño — Reportar una zona afectada en el mapa

**Historia:** `EP-02.F1.US3` Reportar una zona afectada en el mapa · **Tarea Azure DevOps:** `248` (Design, 2 h)
**Rama:** `EP-02.F1.US3` · **Repositorio:** `Nexo-Vital/Back_NexoVital` · **Sprint:** `Nexo_Vital\Sprint 1`
**Estado:** propuesto, pendiente de revisión del equipo
**Tareas que consumen este diseño:** `249` (endpoint que registra y publica), `250` (formulario en el frontend), `251` (prueba del reporte exitoso)
**Ámbito:** solo diseño. No se escribe código de producción en esta tarea.

> **Convención de lectura.** **`NUEVO`** = nombre o archivo que este diseño introduce y que hoy **no existe** en el repositorio. **`REFERENCIA`** = comportamiento ya probado en la implementación de referencia (`arws-inception/backend/`, ver §2.3). **`NO ENCONTRADO`** = algo que este diseño necesitaba y que **no existe** ni en el contrato ni en el front ni en el back; se propone como **decisión explícita**, nunca se asume como existente.

---

## 1. Objetivo y alcance

La historia exige que se pueda **reportar una zona afectada** indicando **tipo de emergencia y ubicación**, de modo que **los centros de ayuda cercanos la vean de inmediato en el mapa**. La descripción de la tarea 248 lo fija: *"Definir los campos mínimos: tipo de emergencia y ubicación"*; la 249 añade el *"Endpoint que registra la zona y la deja visible de inmediato en el mapa"*.

Este diseño decide **qué se registra, con qué campos, en qué módulo, por qué endpoint y por qué canal se hace visible**; no implementa el formulario (250) ni la prueba (251), pero los deja listos para implementar.

| Dentro del alcance (248) | Fuera del alcance (otras tareas / historias) |
|---|---|
| Campos mínimos del reporte y su justificación | El formulario y la pantalla (250) |
| Dónde vive el reporte en los módulos del back | La prueba automatizada (251) |
| El endpoint (reuso del contrato) y el delta OpenAPI | El canal realtime en sí (tarea 244 / US2) |
| Cómo se engancha con el canal de la US2 | La actualización y el borrado de elementos (US4/US5) |
| La autorización con `SecurityConfig` fail-closed | GPS de hardware, correo, SMS o push |
| Los casos de prueba que 251 debe ejecutar | El outbox transaccional con broker y la idempotencia de red completa |

---

## 2. Punto de partida

### 2.1 Lo que el repositorio trae hoy

| Elemento | Estado | Evidencia |
|---|---|---|
| Módulo `mapa` (zonas con contorno + centros por puerto) | Implementado (read-model) | `mapa/domain/model/Zona.java`, `mapa/domain/port/out/ZonaRepository.java` |
| Punto-en-polígono de una zona | Implementado | `Zona.java:70-90` (`contiene(Ubicacion)`) |
| `GET /api/v1/mapa` (zonas + centros) | Implementado (tarea 241, cerrada) | `MapaController.java:37-45` |
| `Zona` con `contorno` publicado | Implementado | `ZonaDto.java:13`; contrato `Zona` en `openapi.yaml:665-674` |
| Seis zonas de Bogotá sembradas (Suba, Usaquén, Engativá, Kennedy, Bosa, Centro) | Sembrado | `DataSeeder.java:119-164` |
| Tres centros de acopio sembrados (Suba) | Sembrado | `DataSeeder.java:97-100` |
| `SecurityConfig` fail-closed | CONFIGURADO (`anyRequest().denyAll()`) | `SecurityConfig.java:57-76` |
| Autoridad `ROLE_<ROL>` publicada por el filtro | CONFIGURADO | `SecurityConfig.java:31-33`; `JwtAuthFilter.java` |
| `@EnableMethodSecurity` | **NO ENCONTRADO** | grep en `src/main/java` sin coincidencias (ver US2 §2.1) |
| Agregado/tabla/controlador de `Emergencia` en el back | **NO ENCONTRADO** | grep `Emergencia` en `src/main/java` solo aparece en `DataSeeder` (fixtures del front) |
| Publicador de eventos (`PushPort`, `SimpMessagingTemplate`, `@TransactionalEventListener`) | **NO ENCONTRADO** | grep sin coincidencias; el canal lo diseña la US2, no está implementado |
| `Ubicacion` de dominio con validación de rango | Implementado | `usuarios/domain/model/Ubicacion.java:10-19` |

### 2.2 Lo que NO existe todavía

- **No hay** módulo, agregado, tabla, repositorio ni endpoint de `Emergencia` en el back.
- **No hay** canal realtime implementado (ni `PushPort`, ni broker, ni STOMP): es diseño de la US2 (`ep-02-f1-us2-canal-tiempo-real-mapa.md`).
- **No hay** motor de migraciones (`pom.xml` sin Flyway/Liquibase, ver diseño de login §4.3): el esquema lo crea Hibernate.
- El front **no** resuelve la zona de un punto (solo resuelve la zona de un centro por `zonaId`, `zone-selection.ts:14-22`).

### 2.3 Implementación de referencia (`REFERENCIA`)

Entrega previa funcional en `arws-inception/backend/` (mismo `pom.xml`). Rutas relativas a `arws-inception/backend/`.

| Elemento de referencia | Ruta |
|---|---|
| Controlador REST con envelope `{codigo, mensaje}` en el borde del módulo | `.../usuarios/infrastructure/adapter/in/AuthController.java:34-42` |
| Patrón de escritura atómica `@Modifying` | `.../recursos/infrastructure/adapter/out/ItemInventarioJpaRepository.java:25` |
| `WebSocketConfig` (STOMP `/ws`) — se porta en la US2 | `.../infrastructure/config/WebSocketConfig.java:16-32` |

### 2.4 El front que ya existe (pieza central de este diseño)

El front **ya tiene** un formulario de "reportar emergencia" y todo el camino de consumo; el diseño lo **reconcilia**, no lo reinventa.

| Pieza | Qué es | Ruta |
|---|---|---|
| `EmergencyFormValues` | `{nivel, zonaId, descripcion, lat, lng}` | `emergency-form.ts:4-10` |
| `validateEmergencyForm` | Exige `zonaId`, `descripcion`, y lat/lng numéricos en rango | `emergency-form.ts:33-48` |
| `buildEmergency` | Arma la `Emergencia` con `estado: 'REPORTED'` y `zonaId` **del cliente** | `emergency-form.ts:51-69` |
| `nextEmergencyId` | Genera el id **en el cliente** (`EMG-001`, `EMG-002`…) | `emergency-form.ts:22-31` |
| `EmergencyFormDialog` | Formulario: `nivel`, `zonaId`, `descripcion`, lat/lng y botón "Use map center" | `EmergencyFormDialog.tsx:61-67`, `:163-210` |
| `CrueActions` | Botón "Report emergency" **restringido por rol** | `CrueActions.tsx:16` (`EMERGENCY_ROLES = ['ADMIN_PLATAFORMA', 'ADMIN_CENTRO_AYUDA']`) |
| `useEmergencySync` | Se **suscribe** a `/topic/emergencias` y hace UPSERT | `use-emergency-sync.ts:37-56` |
| `emergency-store` | UPSERT por `id` (id desconocido se crea, conocido se fusiona) | `emergency-store.ts:16-28` |
| `MapCanvas` | Dibuja las emergencias del store sobre el mapa | `SalaOperacionesPage.tsx:264-276` |
| `useDeviceLocation` | GPS con estados `prompt/granted/denied/unavailable/unsupported` + fallback simulado | `use-device-location.ts:5`, `:57-113` |
| Ubicación de respaldo | `SIMULATED_START = {lat: 4.653, lng: -74.06}` + mensaje de contexto inseguro | `use-device-location.ts:21`, `:24-25` |
| `DESTINATIONS` del front | Cuatro destinos; `/topic/emergencias` es uno | `messages.ts:18-23` |
| `Zona` del front con `contorno` opcional | Se pinta como polígono, no como punto | `types/domain.ts:173-179`; `zone-selection.ts:33-38` |
| `Ubicacion` del front | `{lat, lng}` | `types/domain.ts:33-36` |

### 2.5 Contradicciones detectadas (se declaran, no se tapan; R1 ya resuelto)

1. **Rol del reporte: resuelto — manda Azure, el rol es `CIUDADANO`.** El enunciado de la historia en Azure (184 / `EP-02.F1.US3`) dice *"Como **ciudadano** quiero reportar una zona afectada…"*, y la decisión del equipo (2026-09-23) es **hacer caso a lo que diga Azure**. El catálogo del repo dice *"**Como administrador de plataforma** quiero reportar una zona afectada…"* (`historias-de-usuario.md:202`; `historias-de-usuario-realtime.md:126`; tabla del story map `historias-de-usuario.md:80`) y el front restringe el botón a `ADMIN_PLATAFORMA`/`ADMIN_CENTRO_AYUDA` (`CrueActions.tsx:16`), pero **eso ya no decide el rol**: es una **desalineación del catálogo** que hay que corregir para que las fuentes digan lo mismo (acción pendiente P1, §8). El rol autorizado por este diseño queda fijado en **`CIUDADANO`** (D7).
2. **Contrato vs. US2 sobre quién produce el evento del mapa.** El contrato enruta una emergencia nueva a `/topic/emergencias` (`openapi.yaml:220-222`; `contract/README.md:16-22`), mientras que el diseño de la US2 atribuyó US3 a `CrearZona` en `mapa` y a `/topic/map.events` (`ep-02-f1-us2-…:246-253`, `:365`). Este diseño sigue el **contrato** (el reporte es una `Emergencia`, no una `Zona`) y declara el desalineamiento (D6, riesgo R2).
3. **"Tipo de emergencia" no es un campo del contrato.** El schema `Emergencia` tiene `nivel` (severidad) y `descripcion` (texto), **no** un campo `tipo` (`openapi.yaml:693-710`). Se declara `NO ENCONTRADO` y se decide **no inventarlo** (D2).
4. **`zonaId` y los enums del front no coinciden con el contrato.** El front exige `zonaId` en la `Emergencia` (`types/domain.ts:47-48`) y enums en inglés (`LOW/MEDIUM/HIGH/CRITICAL`, `REPORTED`…), mientras que el contrato no tiene `zonaId` y usa enums en español (`BAJO/MEDIO/ALTO/CRITICO`, `REGISTRADA`, `openapi.yaml:687-710`). `useEmergencySync.isEmergencia` **rechazaría** un payload con la forma cruda del contrato (`use-emergency-sync.ts:6-7`, `:19`). Se declara como brecha de integración (D8, riesgo R3).
5. **Contrato `Zona` sin `contorno` vs. back que sí lo publica.** El schema `Zona` del contrato solo declara `id, nombre, ubicacion` (`openapi.yaml:665-674`), pero el back publica `contorno` (`ZonaDto.java:13`) y el front lo consume (`zone-selection.ts:33-38`). Desalineamiento aditivo, se declara (riesgo R4).
6. **La historia dice "zona afectada" (área); el contrato modela un punto.** `Emergencia.ubicacion` es `{lat, lng}` (`openapi.yaml:700-701`), no un polígono. La zona (área) se **deriva** del punto con el contorno ya sembrado (D4).

---

## 3. Decisiones de diseño

### D1 — El reporte es una `Emergencia` y vive en el módulo `mapa`

- **Decisión:** se crea un agregado `Emergencia` (**`NUEVO`**) dentro del módulo `mapa` (`mapa/domain/model/`), con su repositorio, su caso de uso `ReportarEmergenciaUseCase` (**`NUEVO`**) y su controlador `EmergenciaController` (**`NUEVO`**, `POST /api/v1/emergencias`). La tabla `emergencias` es privada del módulo.
- **Por qué el módulo `mapa`:**
  1. La épica de la historia es **EP-02** y el ADR-0003 fija **un módulo por épica**: `mapa (EP-02)` (`ADR-0003:45-47`; `system-design/10:43-50`). Abrir un módulo `emergencias` aparte partiría la épica EP-02 y su frontera de extracción.
  2. El `package-info` del módulo declara literalmente **"Zonas afectadas, centros y puntos de entrega"** (`mapa/package-info.java:1-3`): la zona afectada es el sujeto del módulo.
  3. El módulo ya es dueño de `Zona` con `contiene()` y de `ZonaRepository` (`Zona.java:70-90`, `ZonaRepository.java:12-18`), que es lo que permite **resolver la zona** del punto reportado sin cruzar esquemas.
  4. El reporte se hace visible por el mismo `PushPort` que la US2 coloca en `mapa` (`ep-02-f1-us2-…:246-253`).
- **Rechazado:** un módulo `emergencias` nuevo. Duplica la frontera de EP-02 y el contrato etiqueta `/emergencias` como `EP-02` (`openapi.yaml:194`).
- **Ubicación exacta de cada archivo nuevo:** §D10.

### D2 — Campos mínimos: `ubicacion` + `nivel` + `descripcion` (los tres que el contrato ya exige)

- **Decisión:** el cuerpo mínimo del reporte es exactamente **`{ubicacion, nivel, descripcion}`**. Son los tres campos **obligatorios** que el contrato ya declara para `POST /emergencias` (`openapi.yaml:203`). `id`, `estado` y `createdAt` los asigna el **servidor** (no viajan en la petición).
- **"Tipo de emergencia" no existe como campo (`NO ENCONTRADO`).** El schema `Emergencia` no tiene `tipo` (`openapi.yaml:693-710`). Se interpreta así:
  - **`nivel`** (`NivelEmergencia`: `BAJO | MEDIO | ALTO | CRITICO`) es el tipo **estructurado** (severidad) que el contrato sí define.
  - **`descripcion`** (texto libre) nombra el tipo en lenguaje natural ("incendio", "derrumbe", "inundación").
- **Por qué no se inventa un campo `tipo`:** la regla del proyecto es no inventar campos (`nexo-vital` skill; `ep-02-f1-us2-…:9`). Añadir un enum `tipo` al contrato es un cambio de contrato, no una decisión de esta tarea; queda propuesto y **fuera de alcance** si el equipo lo pide.
- **Por qué `nivel` y `descripcion` y no solo uno:** el contrato los exige **ambos**; quitar cualquiera rompería el `required` del contrato. El formulario del front ya los pide (`emergency-form.ts:4-10`).
- **Consecuencia para el front (250):** el `zonaId` y el `id` que hoy arma el cliente (`emergency-form.ts:35-37`, `:22-31`) **dejan de ser autoridad**; el `id` lo asigna el servidor y el `zonaId` lo resuelve el servidor (D4). El formulario puede seguir mostrándolos, pero como contexto, no como decisión.

### D3 — La ubicación la elige el ciudadano en el mapa; el GPS y el "centro del mapa" son atajos

- **Decisión:** la ubicación se compone de tres fuentes, en este orden de precedencia:
  1. **Punto elegido en el mapa** (primaria). El formulario ya recibe `mapCenter` y tiene el botón **"Use map center"** (`EmergencyFormDialog.tsx:61-67`, `:208-210`); se generaliza a "el punto que el ciudadano toca en el mapa".
  2. **GPS del dispositivo** (atajo), reutilizando **`useDeviceLocation()`** tal cual existe (`use-device-location.ts:57-113`), con sus estados `prompt/granted/denied/unavailable/unsupported`.
  3. **Entrada manual de lat/lng** (respaldo), que el formulario ya tiene (`EmergencyFormDialog.tsx:163-206`).
- **Si no hay permiso o no hay HTTPS:** `status = denied | unsupported | unavailable`; **el reporte no se bloquea**: el ciudadano sigue eligiendo el punto en el mapa o escribiendo lat/lng. El mensaje de contexto inseguro ya existe (`INSECURE_CONTEXT_MESSAGE`, `use-device-location.ts:24-25`) y se muestra; la posición simulada (`SIMULATED_START`, `:21`) es una comodidad de demo y se etiqueta con `simulated: true`.
- **Validación de geometría (AC2):** el rango se valida en el servidor con el record `Ubicacion` (**ya existente**), que rechaza `lat ∉ [-90, 90]` y `lng ∉ [-180, 180]` (`Ubicacion.java:12-18`) → **400**. El front ya valida lo mismo (`parseLatitude`/`parseLongitude`, `emergency-form.ts:41-46`).
- **Rechazado:** GPS **solo** (bloquearía escritorio y a quien niega el permiso) y mapa **solo** (ignoraría el dispositivo). La combinación es la que el front ya tiene y la que la historia necesita ("desde la vida real").

### D4 — La zona NO se crea: se resuelve del punto con el punto-en-polígono ya implementado

- **Decisión:** el reporte es un **punto**. La **zona afectada** se deriva en el servidor: se recorre `ZonaRepository.listar()` y se aplica `Zona.contiene(punto)` (`Zona.java:70-90`) — el mismo algoritmo que ya usa `MapaHttpTest.t5_cadaCentroCaeDentroDeSuZona` (`MapaHttpTest.java:165-204`). El `zonaId` resultante es contexto; si el punto no cae en ninguna zona sembrada, el reporte **se acepta igual** con `zonaId = null` (no es "geometría inválida", es una zona fuera del catálogo).
- **Por qué:** el cliente no puede ser la autoridad de la zona. Hoy el formulario pide un `zonaId` de **texto libre** (`emergency-form.ts:35-37`), lo que permite reportar "Suba" estando en Kennedy. *"El servidor es la única fuente de verdad"* (`README.md:62`; `nexo-vital` skill). La resolución por punto es determinista y ya está probada.
- **Por qué no se crea una `Zona` nueva:** `Zona` es una **localidad de referencia** con `contorno` sembrado e `id` que las organizaciones usan como `zonaId` (`Zona.java:8-25`; `DataSeeder.java:102-164`). Crear zonas desde un reporte ensuciaría ese catálogo y los `zonaId` de los centros. La historia dice "reportar una zona **afectada**", es decir marcar que un área existente está afectada — lo que modela la emergencia, no la localidad.
- **Rechazado:** que el cliente mande el `zonaId` como autoridad (rompe la regla del servidor); que el reporte exija un polígono (el contrato no lo tiene y sería inventar un payload de área).

### D5 — Endpoint: se reutiliza `POST /api/v1/emergencias` del contrato

- **Decisión:** el reporte entra por **`POST /api/v1/emergencias`**, ya definido en el contrato (`openapi.yaml:192-222`), con cuerpo `{ubicacion, nivel, descripcion}` y respuesta **201** con el schema `Emergencia`. **No se crea ningún endpoint nuevo.**
- **Evidencia:**
  - El contrato ya lo declara como *"Reportar una emergencia"* (`openapi.yaml:196`), con los campos exactos que pide la 248 (`:203`).
  - Ya declara su publicación: `x-usa-publicacion.canales: ['/topic/emergencias/{id}', '/topic/emergencias']` (`:220-222`).
  - `contract/README.md:37` lo lista como `POST /emergencias` con *"Publish post-commit a `/topic/emergencias`"*.
  - El front **ya implementa el consumidor** (`useEmergencySync` → `/topic/emergencias` → `emergency-store` → `MapCanvas`).
- **Rechazado:** un `POST /api/v1/mapa/zonas` nuevo. El contrato define `/mapa` **solo con `GET`** (`openapi.yaml:178-191`), la `Zona` no tiene `tipo`/`nivel` y el reporte sí, y sería inventar un endpoint y un payload de área que no existen.

### D6 — "Visible de inmediato en el mapa" = publicar post-commit a `/topic/emergencias` por la infraestructura de la US2

- **Decisión:** el caso de uso, **tras el commit**, publica la `Emergencia` por el **mismo mecanismo de la US2**: el módulo dueño (`mapa`) arma el payload `{destination, payload}` y lo entrega al `PushPort` (**`NUEVO`**, diseño US2 D5) → `ws.push` (fanout) → `gateway` (`SimpMessagingTemplate`, Modelo Y) → STOMP. El **destino concreto es `/topic/emergencias`**, el que el contrato ya declara para *"Nueva emergencia reportada"* (`contract/README.md:17`) y que la US2 lista como **YA DEFINIDO** (`ep-02-f1-us2-…:124`).
- **Por qué `/topic/emergencias` y no `/topic/map.events`:** el contrato enruta una emergencia nueva a `/topic/emergencias` (`:220-222`) y el front **ya se suscribe a ese destino** (`messages.ts:20`; `use-emergency-sync.ts:44`). `/topic/map.events` (US2 D3, `:128`) es el ciclo de vida de **zonas y centros** (elementos del mapa), no de emergencias.
- **Qué queda del otro canal:** `/topic/map.events` y `mapa.elemento.upsert` siguen siendo de **US4/US5** (actualizar/eliminar elementos) y de la geometría de zonas; el reporte inicial no los necesita.
- **Contradicción declarada (riesgo R2):** el diseño de la US2 atribuyó US3 a `CrearZona`/`/topic/map.events` (`:246-253`, `:365`). Se **corrige la atribución**: el productor de la US2 que alimenta `/topic/map.events` no es US3 sino US4/US5 (o un productor de prueba, como la propia US2 admite en R1). El canal de la US2 **no cambia**; cambia de quién se dice que lo alimenta.
- **Regla de oro respetada:** publicar **post-commit**, nunca intra-transacción (`contract/README.md:22-29`; US2 D6 `:179-184`). El MVP lo resuelve con `@TransactionalEventListener(AFTER_COMMIT)` en el módulo dueño; el outbox transaccional queda diferido (US2 D6).
- **≤ 1 s:** es el criterio del catálogo (`historias-de-usuario-realtime.md:130`, `historias-de-usuario.md:206`); la US2 lo mide con dos sesiones (US2 D9).

### D7 — Autorización: matcher explícito en `SecurityConfig` (fail-closed, sin `@EnableMethodSecurity`)

- **Problema:** el `SecurityConfig` es **fail-closed** (`anyRequest().denyAll()`, `SecurityConfig.java:76`). Sin declarar `POST /api/v1/emergencias`, la ruta sería **denegada**. Y el repo **no tiene `@EnableMethodSecurity`** (US2 §2.1: `@PreAuthorize` **no se evalúa**).
- **Decisión:**
  1. Añadir a `SecurityConfig` una declaración explícita, junto a las existentes (`:57-71`):
     - `POST /api/v1/emergencias` → **`.hasAuthority("ROLE_CIUDADANO")`** (rol fijado por Azure, ver abajo).
     - `GET /api/v1/emergencias` y `GET /api/v1/emergencias/{id}` → `.authenticated()` (lectura del mapa/registro, misma audiencia que `GET /api/v1/mapa`, `:71`).
     - `PATCH /api/v1/emergencias/{id}` → el rol de coordinación (US4, fuera de esta tarea).
  2. **No** usar `@PreAuthorize` (no se evalúa). Toda la autorización vive en `SecurityConfig`.
  3. Reutilizar la autoridad `ROLE_<ROL>` que **ya** publica `JwtAuthFilter` (`SecurityConfig.java:31-33`): no hay que construir nada nuevo para concederla.
- **El rol (R1, resuelto): `CIUDADANO`.** El enunciado de la historia en Azure (184 / `EP-02.F1.US3`) dice *"Como **ciudadano** quiero reportar una zona afectada…"* y **el backlog de Azure manda** (decisión del equipo, 2026-09-23). La declaración concreta queda así:
  1. `POST /api/v1/emergencias` → **`.hasAuthority("ROLE_CIUDADANO")`**.
  2. **El catálogo del repo contradice a Azure** (`historias-de-usuario.md:202`; `historias-de-usuario-realtime.md:126`; story map `historias-de-usuario.md:80` dicen *"administrador de plataforma"*). **No se tapa**: se registra como **acción pendiente del equipo** para corregirlo y que las fuentes digan lo mismo (P1, §8).
  3. **Alcance del front (250):** el front solo cubre los **dos perfiles del MVP** que ofrece su panel de demo — **`CIUDADANO` y `CONDUCTOR`** (`DemoProfilesPanel.tsx:34`). Los roles de administración (`ADMIN_PLATAFORMA`, `ADMIN_CENTRO_AYUDA`, `ADMIN_ACOPIO`) **quedan fuera del alcance del front**.
  4. **Consecuencia para la tarea 250:** hoy el botón de reportar está restringido a administradores (`CrueActions.tsx:16`); en la 250 hay que **abrirlo al ciudadano** y **probar que no se rompe lo que ya funciona** (P2, §8).
  5. **Aclaración — CRUE, fuera de alcance:** que el CRUE también pueda reportar (es su trabajo y ya está construido) es una decisión **aparte del MVP**, no lo que pide la historia. Queda anotado como **fuera de alcance**, **no** como permiso vigente.
- **Rechazado:** dejar la ruta sin declarar (fail-closed la niega, *no* la deja abierta a todo rol autenticado); usar `@PreAuthorize` (no se evalúa).

### D8 — `zonaId` y los enums del front: brecha de integración declarada

- **Situación:** el front exige `zonaId: string` y enums en inglés en la `Emergencia` que recibe (`types/domain.ts:47-48`; `use-emergency-sync.ts:6-7`, `:19`), pero el contrato **no tiene `zonaId`** y usa enums en español (`openapi.yaml:687-710`). Un payload con la forma cruda del contrato **sería rechazado** por `isEmergencia`.
- **Decisión:**
  1. El back devuelve el `zonaId` **resuelto** (D4) como propiedad **adicional y opcional** de la respuesta/payload. Es aditivo y no rompe el contrato; y es lo correcto porque **solo el servidor** puede resolver la zona.
  2. La **traducción de enums** contrato (español) ↔ UI (inglés) se hace **en el borde de la API** del front, como ya documenta `domain.ts:1-17` (el front normaliza `BAJO→LOW`, `REGISTRADA→REPORTED`, …). La tarea 250 debe confirmar el punto exacto (adaptador de `apiClient` o el propio `useEmergencySync`) y ajustar `isEmergencia` en consecuencia.
- **Por qué se declara y no se esconde:** es una brecha real entre lo que el back publicará y lo que el front acepta hoy; si no se cierra, el reporte se guarda pero **no aparece** en el mapa — justo el criterio AC1.

### D9 — Idempotencia (AC3): no existe en el contrato; se propone y se difiere

- **Situación (`NO ENCONTRADO`):** el AC3 de la historia exige que *"un reintento de red del mismo registro… la zona quede una sola vez"* (`historias-de-usuario.md:208`; `historias-de-usuario-realtime.md:132`). El contrato **no** define `Idempotency-Key`, ni un `requestId` en el cuerpo, ni un endpoint de deduplicación (`openapi.yaml:192-222`). Y `POST /emergencias` no tiene clave natural de unicidad.
- **Decisión:** proponer una **cabecera opcional `Idempotency-Key`** (o un `requestId` en el cuerpo) deduplicada en el servidor por una tabla/columna del módulo `mapa`, y **diferirla** salvo que la tarea 251 deba cubrir AC3. Si se difiere, **AC3 queda sin cumplir** y se declara como tal (riesgo R5).
- **Por qué no se resuelve "gratis":** sin clave idempotente, dos reintentos crean dos `Emergencia` distintas (ids UUID distintos). La deduplicación exige que el cliente mande algo estable, y hoy no lo manda.

### D10 — Ubicación de cada pieza en la arquitectura de este repositorio

| Capa del módulo `mapa` | Componente | Estado |
|---|---|---|
| `domain/model/` | `Emergencia` (inmutable), `NivelEmergencia`, `EstadoEmergencia` | `NUEVO` |
| `domain/port/out/` | `EmergenciaRepository` | `NUEVO` |
| `domain/port/out/` | `PushPort` (publica `{destination, payload}` a `ws.push`) | `NUEVO` (diseño US2 D5) |
| `domain/port/in/` | `ReportarEmergenciaUseCase` | `NUEVO` |
| `application/usecase/` | `ReportarEmergenciaUseCaseImpl` (valida → resuelve zona → guarda → publica post-commit) | `NUEVO` |
| `infrastructure/adapter/in/` | `EmergenciaController` (`POST /api/v1/emergencias`) + DTOs | `NUEVO` |
| `infrastructure/adapter/out/` | `EmergenciaJpaRepository`, `EmergenciaRepositoryAdapter` | `NUEVO` |
| `infrastructure/adapter/out/` | Adaptador del `PushPort` (MVP: evento en proceso; destino: AMQP) | `NUEVO` (US2) |
| `infrastructure/config/` | Declaración del matcher de `POST /emergencias` en `SecurityConfig` | MODIFICACIÓN |
| Front | Formulario que envía a la API y resuelve la ubicación (mapa/GPS/manual) | `NUEVO` (tarea 250) |
| Front | `useEmergencySync` ajustado a la forma del payload | MODIFICACIÓN (D8) |

El flujo respeta la dirección de dependencias: `application/usecase` depende solo de `domain` (puertos); `infrastructure/adapter` implementa los puertos; el dominio no importa Spring, ni BD, ni STOMP (`backend/README.md:41-43`; `system-design/10:89-91`).

### D11 — Alternativas descartadas (tabla de decisión)

| Criterio | `POST /mapa/zonas` nuevo (área) | Módulo `emergencias` nuevo | `POST /emergencias` (elegido) |
|---|---|---|---|
| Ya está en el contrato | ✗ (no existe) | ✗ | ✓ (`openapi.yaml:192-222`) |
| Campos de la 248 (`nivel`+`descripcion`) | ✗ (`Zona` no tiene) | ✓ | ✓ (`:203`) |
| El front ya lo consume | ✗ | ✗ | ✓ (`use-emergency-sync.ts`) |
| No ensucia el catálogo de localidades | ✗ (crearía zonas) | ✓ | ✓ (la zona se deriva) |
| Frontera de módulo (ADR-0003) | ✗ (endpoint inventado) | ✗ (parte EP-02) | ✓ (`mapa` = EP-02) |
| Canal de publicación ya declarado | ✗ | ✗ | ✓ (`/topic/emergencias`, `:220-222`) |

- **`POST /mapa/zonas` (crear la zona como área):** descartado. El contrato no lo tiene, `Zona` no admite `nivel`/`descripcion`, y crearía localidades desde un reporte. La zona se **deriva** del punto (D4); el área del mapa se sigue sirviendo por `GET /mapa`.
- **Módulo `emergencias` nuevo:** descartado. Parte la épica EP-02 y su frontera de extracción (`ADR-0003:45-47`).
- **`@PreAuthorize`:** descartado. No hay `@EnableMethodSecurity`; la anotación no se evalúa (D7).
- **Que el cliente decida el `zonaId` (como hoy):** descartado. Rompe *"el servidor es la única fuente de verdad"* (`README.md:62`); el `zonaId` de texto libre puede no corresponder al punto.
- **Escribir directo al canal realtime sin persistir:** descartado. El servidor es la fuente de verdad y el publish va **post-commit** (`contract/README.md:22-29`).

---

## 4. Modelo de datos y contrato

### 4.1 Tabla `emergencias` (`NUEVA`, privada del módulo `mapa`)

```sql
CREATE TABLE emergencias (
  id            UUID         PRIMARY KEY,
  ubicacion_lat DOUBLE       NOT NULL,
  ubicacion_lng DOUBLE       NOT NULL,
  nivel         VARCHAR(20)  NOT NULL,   -- BAJO | MEDIO | ALTO | CRITICO
  estado        VARCHAR(20)  NOT NULL,   -- REGISTRADA | EN_ATENCION | EN_ESPERA | RESUELTA | CERRADA
  descripcion   VARCHAR(500) NOT NULL,
  zona_id       VARCHAR(120) NULL,       -- resuelta por punto-en-polígono (D4); NULL si cae fuera
  created_at    TIMESTAMP    NOT NULL
);
```

| Columna | Significado |
|---|---|
| `nivel` | Severidad, `NivelEmergencia` del contrato (`@Enumerated(STRING)`) |
| `estado` | Estado, `EstadoEmergencia` del contrato; nace en `REGISTRADA` |
| `zona_id` | Contexto derivado, **no** una clave foránea (frontera de datos, `ADR-0003:48-50`) |
| `created_at` | Instante absoluto, con el `Clock` inyectable que ya existe (`ClockConfig.java`; login D8) |

- **Sin motor de migraciones:** el esquema lo crea Hibernate (`ddl-auto`), igual que el resto (diseño de login §4.3).
- **Invariantes:** `nivel` y `estado` ∈ sus enums; `-90 ≤ lat ≤ 90`, `-180 ≤ lng ≤ 180` (garantizado por el record `Ubicacion`); `estado` nace en `REGISTRADA`; `id` es UUID del servidor.

### 4.2 Petición y respuesta (contrato, sin cambios)

| Elemento | Valor | Origen |
|---|---|---|
| Método y ruta | `POST /api/v1/emergencias` | `openapi.yaml:192-196` |
| Cuerpo | `{ubicacion: {lat, lng}, nivel, descripcion}` | `openapi.yaml:203-210` |
| Respuesta | `201` + `Emergencia` (`id, ubicacion, nivel, estado, descripcion, createdAt`) | `openapi.yaml:212-217`, `:693-710` |
| Publicación | `/topic/emergencias` (y `/topic/emergencias/{id}` en la actualización) | `openapi.yaml:220-222` |

---

## 5. Flujo del reporte

```
  Front (250): punto del mapa | GPS (useDeviceLocation) | lat/lng manual
        │  POST /api/v1/emergencias  {ubicacion, nivel, descripcion}
        ▼
  SecurityConfig: matcher POST /emergencias → ROLE_CIUDADANO   (D7)
        ▼
  EmergenciaController (mapa/infrastructure/adapter/in)
        ▼
  ReportarEmergenciaUseCaseImpl
        ├─ valida geometría (record Ubicacion) y campos    → 400 si falta/está fuera de rango (AC2)
        ├─ resuelve zona: ZonaRepository.listar() + Zona.contiene(punto)   (D4)
        └─ guarda la Emergencia (estado = REGISTRADA)
        │
        │  @TransactionalEventListener(AFTER_COMMIT)   ← post-commit (D6)
        ▼
  PushPort → ws.push (fanout) → gateway (SimpMessagingTemplate, Modelo Y)   [infra US2]
        ▼
  /topic/emergencias ──► front: useEmergencySync → emergency-store.upsert → MapCanvas   (≤ 1 s)
```

- **"Visible de inmediato"** no depende de que el front implemente nada nuevo en el mapa: `useEmergencySync` (`:37-56`) y `emergency-store` (`:16-28`) **ya** existen y `MapCanvas` dibuja las emergencias del store (`SalaOperacionesPage.tsx:264-276`). Lo que falta es el **productor** del back (esta historia) y el canal realtime (US2).
- **"Centros de ayuda cercanos" (`NO ENCONTRADO` como push dirigido):** no existe un canal por centro. El reporte se difunde al mapa compartido; "cercanos" se resuelve por **zona** (los centros cuyo `zonaId` coincide ven la zona afectada). Un push dirigido por centro es una mejora futura, no parte de esta tarea.

---

## 6. Delta del contrato OpenAPI

El endpoint **ya existe**; el delta es mínimo y se declara para que nadie lo dé por inventado.

| Cambio | Detalle | Por qué |
|---|---|---|
| **Sin cambios en la petición** | `POST /emergencias` ya exige `{ubicacion, nivel, descripcion}` | Es exactamente lo que pide la 248 |
| **Aditivo propuesto** | Añadir `zonaId` (**opcional, nullable**) al schema `Emergencia` | El front lo exige (D8) y solo el servidor puede resolverlo (D4) |
| **Sin cambios en la publicación** | `x-usa-publicacion.canales` ya declara `/topic/emergencias` | D6 |
| **Declarar (no cambiar)** | `Zona` del contrato sin `contorno`, aunque el back lo publica | Contradicción §2.5-5 (riesgo R4) |
| **Propuesto, diferido** | `Idempotency-Key` (cabecera) para AC3 | D9 |

---

## 7. Casos de prueba que la tarea 251 debe ejecutar

| # | Caso | Resultado esperado |
|---|---|---|
| T1 | `POST /emergencias` con `{ubicacion, nivel, descripcion}` válidos y token del rol autorizado | **201**, `Emergencia` con `id` UUID, `estado = REGISTRADA`, `createdAt` presente |
| T2 | El punto cae **dentro** del contorno de Suba (`4.73, -74.08`) | El `zonaId` resuelto es `"Suba"` (D4) |
| T3 | El punto cae **fuera** de toda zona sembrada | 201 con `zonaId = null`; el reporte se acepta (no es geometría inválida) |
| T4 | Falta `nivel` (o `ubicacion`, o `descripcion`) | **400** con el envelope `{codigo, mensaje}` (AC2) |
| T5 | `lat = 200` (fuera de rango) | **400** (validación de `Ubicacion`, `Ubicacion.java:12-18`) (AC2) |
| T6 | `POST` **sin** token | **401** `NO_AUTENTICADO` (la ruta está declarada, no denegada por defecto) |
| T7 | `POST` con token de un rol **no** autorizado | **403** `ACCESO_DENEGADO` |
| T8 | El reporte queda visible: tras el `POST`, `GET /api/v1/emergencias` lo incluye | El reporte es consultable (visibilidad REST); la visibilidad realtime la prueba la US2 (D9 de US2) |
| T9 | *(si se implementa D9)* dos `POST` con la misma `Idempotency-Key` | Se crea **una** sola emergencia (AC3) |

- **Patrón de prueba:** `@SpringBootTest` + `@AutoConfigureMockMvc` + `@ActiveProfiles("test")`, login real por `POST /api/v1/sesiones` y token en el `Authorization` — el mismo patrón de `MapaHttpTest` (`:41-45`, `:211-216`) y de `LoginTestBase` (`:56-62`).
- **Nota sobre el canal:** la prueba de "≤ 1 s con dos sesiones" es de la **US2** (su D9); la 251 prueba el **reporte exitoso** por HTTP, no el WebSocket.

---

## 8. Riesgos y decisiones abiertas

| # | Severidad | Riesgo | Propuesta |
|---|---|---|---|
| R1 | **Cerrado** | El catálogo del repo asigna US3 a `ADMIN_PLATAFORMA`; la tarea 248 cita `CIUDADANO` | **Resuelto (2026-09-23): manda Azure → `CIUDADANO`** (D7). Resta corregir el catálogo del repo (P1) |
| R2 | Media | La US2 atribuyó US3 a `CrearZona`/`/topic/map.events`; el contrato enruta la emergencia a `/topic/emergencias` | Corregir la atribución en la US2 (D6); el canal de la US2 no cambia |
| R3 | **Alta** | El front rechaza el payload crudo del contrato (`zonaId` + enums en inglés) | Cerrar la brecha en 250 (D8): `zonaId` aditivo + traducción de enums en el borde de la API |
| R4 | Baja | `Zona` del contrato sin `contorno` vs. back que sí lo publica | Alinear el schema `Zona` del contrato (aditivo) |
| R5 | Media | AC3 (idempotencia) no tiene mecanismo en el contrato | Decidir en 249/251 si se implementa `Idempotency-Key` (D9) o se declara fuera de alcance |
| R6 | Baja | "Tipo de emergencia" no es un campo; se usa `nivel` + `descripcion` | Confirmar con el equipo si hace falta un `tipo` estructurado (cambio de contrato, fuera de alcance) |
| R7 | Baja | Ediciones concurrentes del mismo elemento sin CRDT: last-write-wins | Aceptado para el corte (`retos-concurrencia-v2.md:201`) |
| R8 | Baja | El reporte toca la invariante de convergencia de R1, no C1 ni C2 | No introduce CAS: no hay recurso finito en juego; la única garantía necesaria es el post-commit (D6) |

### 8.1 Acciones pendientes del equipo

| # | Acción | Por qué | Dónde |
|---|---|---|---|
| **P1** | **Corregir el catálogo del repo para que diga `CIUDADANO`** (como Azure): `historias-de-usuario.md:202`, `historias-de-usuario-realtime.md:126` y la tabla del story map `historias-de-usuario.md:80` | Hoy dicen *"administrador de plataforma"* y **contradicen a Azure**, que manda; las fuentes deben decir lo mismo | `arws-inception/historias-de-usuario*.md` (fuera de este repo; **no se tocó** en esta tarea) |
| **P2** | En la **tarea 250**, **abrir el botón de reportar al ciudadano** y **probar que no se rompe lo que ya funciona** | El botón hoy está restringido a administradores (`CrueActions.tsx:16`) y el front solo cubrirá `CIUDADANO`/`CONDUCTOR` (`DemoProfilesPanel.tsx:34`) | `Front_NexoVital/src/features/crue/CrueActions.tsx` (tarea 250) |

---

## 9. Trazabilidad con los criterios de aceptación

| Escenario de `EP-02.F1.US3` (`historias-de-usuario.md:204-208`) | Elemento del diseño | Tarea que lo implementa |
|---|---|---|
| **AC1 — reporto tipo y ubicación → la zona queda visible de inmediato para los centros** | D2 (campos), D3 (ubicación), D4 (zona), D5 (endpoint), D6 (canal `/topic/emergencias`) | 249 (endpoint + publish) + 250 (formulario) |
| **AC2 — geometría inválida o campos faltantes → rechaza e indica el error** | D3 (validación `Ubicacion`), D2 (`required` del contrato) | 249 + 251 (T4/T5) |
| **AC3 — reintento del mismo registro → la zona queda una sola vez** | D9 (idempotencia, propuesta y diferida) | 249/251 (T9), decisión pendiente |
| *"Definir los campos mínimos: tipo de emergencia y ubicación"* (248) | D2 | 248 (este documento) |
| *"Endpoint que registra la zona y la deja visible de inmediato"* (249) | D5, D6 | 249 |
| *"Formulario en el frontend"* (250) | D3, D8, D7 (rol `CIUDADANO`) | 250 (abrir el botón al ciudadano; P2) |
| *"Probar el reporte exitoso"* (251) | §7 (T1–T9) | 251 |

---

## 10. Entregables de la tarea 248

1. Este documento: campos mínimos, ubicación, módulo, endpoint, canal, autorización y pruebas.
2. El DDL de §4.1.
3. Los 9 casos de prueba de §7, como insumo de la tarea 251.
4. Las decisiones explícitas que **no** son código: rol del reporte **`CIUDADANO`** (D7/R1, resuelto), idempotencia (D9/R5) y el delta aditivo del contrato (§6).

**No incluye:** código de producción, el formulario (250), la prueba (251), el canal realtime (US2/244), el outbox transaccional, ni la idempotencia de red completa.
