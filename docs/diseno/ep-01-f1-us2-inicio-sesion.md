# Diseño — Inicio de sesión: usuarios precargados y bloqueo por intentos fallidos

**Historia:** `EP-01.F1.US2` Inicio de sesión de usuario · **Tarea Azure DevOps:** `236` (Design, 2 h)
**Rama:** `EP-01.F1.US2` · **Repositorio:** `Nexo-Vital/Back_NexoVital` · **Sprint:** `Nexo_Vital\Sprint 1`
**Estado:** propuesto, pendiente de revisión del equipo
**Tareas que consumen este diseño:** `237` (endpoint + bloqueo), `238` (pantalla y sesión), `239` (pruebas)
**Ámbito:** solo diseño. No se escribe código de producción en esta tarea.

> **Convención de lectura.** **`NUEVO`** = nombre o archivo que este diseño introduce y que hoy **no existe** en el repositorio. **`REFERENCIA`** = comportamiento ya probado en la implementación de referencia (ver §2.3); se cita para no re-descubrir decisiones, no porque exista en este repositorio.

---

## 1. Objetivo y alcance

La historia exige que, como no hay registro en el MVP, el inicio de sesión valide las credenciales **contra un conjunto fijo de usuarios precargados**, y que tras **3 intentos fallidos seguidos** la cuenta quede **bloqueada temporalmente durante 5 minutos**.

| Dentro del alcance (236) | Fuera del alcance (otras tareas) |
|---|---|
| Modelo de datos de los usuarios precargados | Implementar el endpoint y la lógica (237) |
| Catálogo concreto de usuarios por rol | Formulario, token y redirección por rol (238) |
| Regla de bloqueo, su estado y su expiración | Pruebas automatizadas (239) |
| Delta del contrato HTTP | Motor de migraciones de esquema (tarea aparte) |
| Casos de prueba que 239 debe ejecutar | Revocación de sesiones activas (fuera del MVP) |

**No** se diseña aquí el "bloqueo temporal" del broadcast de ambulancias de C2. Son conceptos distintos que comparten nombre; ver riesgo **R3**.

---

## 2. Punto de partida

### 2.1 Lo que el repositorio trae hoy

Este repositorio arranca **desde cero en código**: solo tiene el andamiaje.

| Elemento | Estado | Evidencia |
|---|---|---|
| Estructura hexagonal por módulo (8 módulos) | Andamiaje vacío | `src/main/java/co/edu/escuelaing/nexovital/` — solo `.gitkeep` y `package-info.java` |
| `pom.xml` con Spring Boot 3.5.16 y Java 21 | CONFIGURADO | `pom.xml:7-23` |
| Dependencias: web, JPA, security, websocket, validation, AMQP | CONFIGURADO | `pom.xml:26-49` |
| JJWT 0.13.0 (api/impl/jackson) | CONFIGURADO | `pom.xml:22`, `pom.xml:51-67` |
| H2 y PostgreSQL como drivers runtime | CONFIGURADO | `pom.xml:69-78` |
| Test: `spring-boot-starter-test` + `spring-security-test` | CONFIGURADO | `pom.xml:80-89` |
| Reglas de arquitectura y responsabilidad de módulos | DOCUMENTADO | `README.md:47-65` |
| `src/main/resources/` | Vacío | solo `.gitkeep` |
| Clase de arranque | NUEVA, mínima | `src/main/java/co/edu/escuelaing/nexovital/NexovitalApplication.java` |

El `README.md` fija cuatro reglas que este diseño respeta y explota:

- **El servidor es la única fuente de verdad** (`README.md:62`).
- **Los invariantes se garantizan por construcción**, con operaciones atómicas en base de datos, nunca con bloqueos en memoria (`README.md:63`).
- **El disparador de un evento es el servicio que ejecuta la transacción** (`README.md:64`).
- **El dominio no depende de Spring ni de JPA** (`README.md:65`).

### 2.2 Lo que NO existe todavía

Todo el dominio y la capa de autenticación. En este repositorio, hoy **no hay**: modelo de usuario, tabla, repositorio, configuración de seguridad, endpoint de login, emisión de JWT, sembrado de datos, pruebas, ni archivos de configuración de aplicación.

### 2.3 Implementación de referencia (`REFERENCIA`)

Existe una entrega previa funcional, guardada como referencia en `arws-inception/backend/` (repo sin remoto): **117 archivos Java**, con la última corrida de pruebas registrada en **51 pruebas, 0 fallos**. Se cita en este documento para reutilizar decisiones ya validadas. Rutas relativas a `arws-inception/backend/`.

| Elemento de referencia | Ruta |
|---|---|
| Agregado inmutable `Usuario` (id, nombre, email, passwordHash, rol) | `src/main/java/.../usuarios/domain/model/Usuario.java:8-14` |
| Enum de roles | `src/main/java/.../usuarios/domain/enums/RolUsuario.java:3-9` |
| Caso de uso de login sin estado | `src/main/java/.../usuarios/application/usecase/AuthenticationUseCaseImpl.java:29-40` |
| Controlador de login, 401 en línea | `src/main/java/.../usuarios/infrastructure/adapter/in/AuthController.java:34-42` |
| Envelope de error `{codigo, mensaje}` | `src/main/java/.../shared/infrastructure/dto/ErrorResponse.java:3` |
| Patrón de escritura atómica `@Modifying` | `src/main/java/.../recursos/infrastructure/adapter/out/ItemInventarioJpaRepository.java:25` |
| Seguridad stateless + autoridad `ROLE_<ROL>` | `src/main/java/.../infrastructure/config/SecurityConfig.java:36-44` |
| Hash BCrypt | `src/main/java/.../usuarios/infrastructure/adapter/out/PasswordEncoderAdapter.java:10` |

**Roles canónicos** (`REFERENCIA`, `RolUsuario.java:4-8`; replicados en el contrato `contract/openapi.yaml:593` del repo de documentación): `CIUDADANO`, `ADMIN_PLATAFORMA`, `ADMIN_CENTRO_AYUDA`, `ADMIN_ACOPIO`, `CONDUCTOR`.

---

## 3. Decisiones de diseño

### D1 — Los usuarios precargados viven en la tabla `usuarios` del módulo `usuarios`

- **Decisión:** el catálogo es una tabla `usuarios` (**NUEVA**), con un agregado de dominio inmutable `Usuario` en `usuarios/domain/model/`, su adaptador JPA en `usuarios/infrastructure/adapter/out/` y el sembrado en `infrastructure/` (configuración transversal, `README.md:58`).
- **Por qué:** un "usuario precargado" no es un tipo distinto de usuario; solo se distingue por venir sembrado. Una tabla paralela duplicaría el modelo.
- **Rechazado:** catálogo en YAML/JSON leído en memoria. Rompería *"el servidor es la única fuente de verdad"* (`README.md:62`) y dejaría el bloqueo sin dónde persistir.
- **Ubicación exacta de cada archivo nuevo:** §4.3.

### D2 — Catálogo concreto de usuarios precargados (`NUEVO`)

Diez usuarios cubriendo los 5 roles. Se **conserva** la credencial de referencia `rangel@nexovital.co` / `rangel123` para que la entrega previa siga siendo comparable.

| Rol | Email | Contraseña demo | Nombre | Nota |
|---|---|---|---|---|
| `ADMIN_CENTRO_AYUDA` | `rangel@nexovital.co` | `rangel123` | Rangel Dev | Credencial de referencia |
| `ADMIN_PLATAFORMA` | `admin@nexovital.co` | `admin123` | Admin Plataforma | — |
| `ADMIN_CENTRO_AYUDA` | `centro@nexovital.co` | `centro123` | Coordinación CRUE | Segundo operador de la sala |
| `ADMIN_ACOPIO` | `acopio@nexovital.co` | `acopio123` | Admin Acopio Bogotá | Ata el rol al centro de acopio demo |
| `CIUDADANO` | `ciudadano@nexovital.co` | `ciudadano123` | Ciudadano Demo | Rol que consume la épica EP-04 |
| `CONDUCTOR` | `conductor1@nexovital.co` … `conductor5@nexovital.co` | `conductor123` | Conductor ABC101 … ABC505 | **Un conductor por ambulancia** |

**Por qué 5 conductores y no 1:** la evidencia de C2 exige N = 2, 5, 20 conductores recibiendo el broadcast. Con un solo usuario `CONDUCTOR` esa demo es imposible, y la pantalla del conductor (`238`) no se puede probar con dos sesiones en paralelo. El diseño ata un conductor a cada ambulancia sembrada.
**Contraseñas:** se persisten **solo como hash BCrypt**. El texto plano vive únicamente en el código del seeder, nunca en la base ni en el contrato.

### D3 — El seeder nace restringido por perfil

- **Decisión:** el sembrado de datos (`NUEVO`, en `infrastructure/`) debe crearse con `@Profile({"default", "docker", "test"})` o con `@ConditionalOnProperty(name = "nexovital.seed.enabled", havingValue = "true")`, **nunca** activo en `prod`.
- **Por qué, y por qué ya:** la implementación de referencia (`REFERENCIA`) sembraba credenciales demo con un `@Component` sin `@Profile` y escribía la contraseña en texto plano en el log con el mensaje *"solo local"* — una intención que nada en el código garantizaba. Aquí el repositorio está vacío: es más barato que la restricción ** nazca puesta** que agregarla después.
- **Consecuencia:** se documentan las credenciales demo en el `README.md` y en el mensaje de log se registra **solo el email**, nunca la contraseña.
- **Se implementa en la tarea 237**, porque es el mismo cambio que siembra el catálogo de D2.

### D4 — El estado de bloqueo va en dos columnas de `usuarios`, fuera del agregado

- **Decisión:** la tabla `usuarios` incluye `intentos_fallidos INT NOT NULL DEFAULT 0` y `bloqueado_hasta TIMESTAMP NULL`. Se leen y escriben con operaciones atómicas en el adaptador de persistencia, expuestas por un puerto de salida dedicado (**NUEVO** `usuarios/domain/port/out/EstadoIntentosPort.java`). El agregado `Usuario` **no** carga esos campos.
- **Por qué:** el estado de bloqueo es un dato de *intentos de autenticación*, no de la identidad del usuario. Mantenerlo fuera del agregado preserva su inmutabilidad y respeta *"el dominio no depende de Spring ni de JPA"* (`README.md:65`).
- **Rechazado:** tabla separada `intentos_login`. Aporta una entidad, un repositorio y un acceso extra para cero beneficio en el MVP.

### D5 — Regla de bloqueo: conteo, disparo y expiración diferida

Regla única, evaluada **en cada intento de login**:

| Situación al recibir un intento | Comportamiento |
|---|---|
| `bloqueado_hasta` es futuro | **Rechazar con 423 sin evaluar la contraseña y sin incrementar el contador.** La ventana no se extiende por insistir. |
| `bloqueado_hasta` es pasado (ya expiró) | Se ignora el bloqueo y el intento se procesa normal. Si la contraseña falla, el contador **reinicia en 1**. |
| Contraseña correcta | `intentos_fallidos = 0` y `bloqueado_hasta = NULL`. Se emite el token. |
| Contraseña incorrecta y `intentos_fallidos + 1 < 3` | Se incrementa el contador. Respuesta **401** `CREDENCIALES_INVALIDAS`. |
| Contraseña incorrecta y `intentos_fallidos + 1 >= 3` | Se fija `bloqueado_hasta = ahora + 5 min`. Respuesta **423** `CUENTA_BLOQUEADA`. |
| Email inexistente | **401** genérico. No se crea ni se modifica estado de bloqueo. |

- **Expiración diferida, sin `@Scheduled`:** la ventana es por cuenta y se evalúa al vuelo comparando `bloqueado_hasta` contra la hora actual. No hace falta un programador de tareas. Es el mismo criterio que el análisis de riesgo del proyecto fijó para sus locks: *"estado de bloqueo con expiración explícita, no con temporizador en memoria"*.
- **Por qué no se incrementa estando bloqueado:** si el contador siguiera subiendo durante la ventana, un atacante mantendría la cuenta bloqueada indefinidamente. Bloquear sin contar es lo que hace que la ventana termine.
- **Reinicio tras expiración:** si el usuario vuelve a fallar 3 veces después de que expire una ventana, se rebloquea. Es intencional y queda escrito, porque un lector podría esperar un contador acumulativo.

### D6 — El incremento debe ser atómico a nivel de base de datos

- **Decisión:** el incremento y el disparo del bloqueo se resuelven en **una sola sentencia** de actualización condicional, no con lectura-modificación-escritura en Java:

```sql
UPDATE usuarios
   SET intentos_fallidos = intentos_fallidos + 1,
       bloqueado_hasta   = CASE WHEN intentos_fallidos + 1 >= 3 THEN :limite ELSE bloqueado_hasta END
 WHERE id = :usuarioId;
```

- **Por qué:** dos intentos concurrentes sobre la misma cuenta con el patrón leer-y-luego-escribir perderían incrementos, y la cuenta se bloquearía con menos de 3 fallos registrados. El `README.md:63` lo exige explícitamente: *"los invariantes se garantizan por construcción, con operaciones atómicas en base de datos"*. El idioma ya validado en la referencia es `@Modifying` con `clearAutomatically`/`flushAutomatically` (**REFERENCIA**, `ItemInventarioJpaRepository.java:25`).
- El diseño fija el invariante verificable: **el contador nunca pierde incrementos y `bloqueado_hasta` nunca se fija antes del tercer fallo.** La tarea 239 lo prueba (caso T6).

### D7 — Contrato HTTP del bloqueo

- **Decisión:** nueva respuesta **`423 Locked`** con `codigo = "CUENTA_BLOQUEADA"` (`NUEVO`), reutilizando el envelope `{codigo, mensaje}` (`REFERENCIA`, `ErrorResponse.java:3`), más la cabecera **`Retry-After`** con los segundos restantes. El `mensaje` es legible: `"Cuenta bloqueada por intentos fallidos. Reintente en 4 minutos."`
- **Por qué 423 y no 429:** 429 describe límites de tasa por cliente; 423 describe un recurso bloqueado, que es exactamente el estado de la cuenta.
- **Por qué no se extiende el envelope:** mantener `{codigo, mensaje}` uniforme en todo el API es una virtud real; el frontend obtiene la cuenta regresiva del encabezado, no del cuerpo.
- **D7b (opcional, por valor de demo):** si el equipo quiere mostrar "intento 2 de 3" en pantalla, se añade a `ErrorResponse` un campo **opcional nullable** `intentosRestantes` (Integer). Es aditivo y no rompe el contrato existente.
- **Dónde se maneja:** una excepción de dominio **NUEVA** `CuentaBloqueadaException`, capturada en el adaptador de entrada del login, igual que el 401 de credenciales inválidas (`REFERENCIA`, `AuthController.java:39-42`), manteniendo el manejo de errores de autenticación dentro del módulo `usuarios`.

### D8 — Reloj inyectable para que los 5 minutos sean verificables

- **Decisión:** exponer un bean `java.time.Clock` (**NUEVO**, en `infrastructure/` del módulo `usuarios` o en configuración transversal) e inyectarlo en el caso de uso. El límite se calcula con `Instant.now(clock)`.
- **Por qué:** una regla de ventana temporal no se puede probar de forma determinista sin controlar el reloj; la alternativa es dormir 5 minutos en la suite, que es inaceptable. La tarea 239 necesita avanzar el tiempo (casos T3 y T5).
- **Alternativa aceptada:** no inyectar el reloj y, en las pruebas, escribir `bloqueado_hasta` directamente en la base para simular la expiración. Sigue verificando la regla; pierde precisión sobre el cálculo del límite.

### D9 — El bloqueo impide obtener token nuevo; no revoca la sesión activa

- **Decisión:** el bloqueo actúa en el camino de login. Un JWT ya emitido **sigue funcionando** hasta su expiración.
- **Por qué:** es el alcance natural del criterio de aceptación ("bloquea temporalmente el intento de inicio de sesión") y evita tocar el filtro de autenticación. Se declara explícitamente para que nadie asuma una revocación que no existe. Endurecerlo queda fuera del MVP.

### D10 — Ubicación de cada pieza en la arquitectura de este repositorio

| Capa del módulo `usuarios` | Componente | Estado |
|---|---|---|
| `domain/model/` | `Usuario` (inmutable) y `RolUsuario` | NUEVO |
| `domain/port/out/` | `UsuarioRepository`, `EstadoIntentosPort` | NUEVO |
| `domain/port/in/` | `AuthenticationUseCase` | NUEVO |
| `domain/exception/` | `CredencialesInvalidasException`, `UsuarioNoEncontradoException`, `CuentaBloqueadaException` | NUEVO |
| `application/usecase/` | `AuthenticationUseCaseImpl` (orquesta: bloqueo → credenciales → contador → token) | NUEVO |
| `infrastructure/adapter/in/` | `AuthController` (`POST /api/v1/auth/login`, `GET /api/v1/auth/me`) + DTOs | NUEVO |
| `infrastructure/adapter/out/` | `UsuarioJpaRepository`, `UsuarioRepositoryAdapter`, `EstadoIntentosAdapter`, `PasswordEncoderAdapter`, `JwtTokenAdapter` | NUEVO |
| `infrastructure/` (transversal) | `SecurityConfig`, `JwtAuthFilter`, `DataSeeder`, bean `Clock` | NUEVO |

El flujo es: `AuthController` → `AuthenticationUseCase` → puertos de salida. La dirección de dependencias apunta hacia adentro, como exige `README.md:65`.

---

## 4. Modelo de datos

### 4.1 Tabla `usuarios` (`NUEVA`)

```sql
CREATE TABLE usuarios (
  id               UUID         PRIMARY KEY,
  nombre           VARCHAR(120) NOT NULL,
  email            VARCHAR(255) NOT NULL UNIQUE,
  password_hash    VARCHAR(255) NOT NULL,
  rol              VARCHAR(40)  NOT NULL,
  intentos_fallidos INT         NOT NULL DEFAULT 0,
  bloqueado_hasta  TIMESTAMP    NULL
);
```

| Columna | Significado |
|---|---|
| `password_hash` | Hash BCrypt. Nunca texto plano |
| `rol` | Uno de los 5 valores canónicos, guardado como texto (`@Enumerated(STRING)`) |
| `intentos_fallidos` | Fallos consecutivos desde el último éxito o desde la última expiración |
| `bloqueado_hasta` | Instante absoluto hasta el cual se rechaza el login. `NULL` o pasado = sin bloqueo |

### 4.2 Invariantes del modelo

1. `0 <= intentos_fallidos <= 3`. Nunca se incrementa por encima de 3, porque al llegar a 3 el siguiente intento se rechaza sin contar.
2. `bloqueado_hasta IS NOT NULL` implica `intentos_fallidos = 3`.
3. `bloqueado_hasta` es siempre un instante absoluto, nunca un tiempo restante.
4. Un login exitoso deja `intentos_fallidos = 0` y `bloqueado_hasta = NULL`.
5. `email` es único, y es la clave de búsqueda del login.

### 4.3 Creación del esquema

El `pom.xml` **no incluye** ningún motor de migraciones (ni Flyway ni Liquibase: no figuran en `pom.xml:25-90`). La creación del esquema queda por tanto a cargo de Hibernate mediante `spring.jpa.hibernate.ddl-auto`, en los archivos de configuración que la tarea 237 creará en `src/main/resources/`. Ver riesgo **R2** para la decisión por perfil.

---

## 5. Máquina de estados del bloqueo

```
                  password incorrecta
   SIN_BLOQUEO ──┬──────────────────> intentos = intentos + 1
   (intentos 0..2)│                        │
                 │                        ├─ intentos < 3 ──> sigue SIN_BLOQUEO → 401
                 │                        │
                 │                        └─ intentos = 3 ──> BLOQUEADO hasta ahora+5min → 423
                 │
                 └── password correcta ──> intentos = 0 → 200 + token

   BLOQUEADO ──── cualquier intento ──> 423 CUENTA_BLOQUEADA + Retry-After (NO incrementa)

   BLOQUEADO ──── pasa el instante ──> SIN_BLOQUEO con intentos = 0 (evaluado en el próximo intento)
```

---

## 6. Delta del contrato OpenAPI

El contrato vive en el repositorio de documentación (`contract/openapi.yaml`). Sobre la operación `POST /auth/login`:

| Cambio | Detalle |
|---|---|
| Añadir respuesta | `'423'` → `$ref: '#/components/responses/Locked'` (**NUEVO**) |
| Añadir componente | `responses/Locked`: cabecera `Retry-After` (integer, segundos) + contenido `#/components/schemas/Error` |
| Actualizar descripción | El componente `Error` lista códigos de ejemplo; añadir `CUENTA_BLOQUEADA` |
| Sin cambios | El `200` y el `401` se mantienen |

El catálogo de usuarios precargados **no se expone** por el contrato: no hay endpoint de listado de usuarios y este diseño no introduce uno.

---

## 7. Casos de prueba que la tarea 239 debe ejecutar

| # | Caso | Resultado esperado |
|---|---|---|
| T1 | 3 contraseñas incorrectas seguidas sobre una cuenta válida | 401, 401, y en el tercero 423 con `codigo = CUENTA_BLOQUEADA` y `Retry-After <= 300` |
| T2 | Estando bloqueado, intento con la **contraseña correcta** | 423. No se evalúan credenciales y no se emite token |
| T3 | Bloqueo expirado (reloj avanzado 5 min + 1 s), contraseña correcta | 200 + token, y `intentos_fallidos = 0` |
| T4 | 2 fallos, 1 éxito, luego 3 fallos | El éxito reinicia; el bloqueo ocurre exactamente en el tercer fallo posterior |
| T5 | 3 intentos con email inexistente | Siempre 401 `CREDENCIALES_INVALIDAS`, nunca 423, y no se crea estado |
| T6 | Intentos fallidos concurrentes sobre la misma cuenta | El contador no pierde incrementos y el bloqueo no se dispara antes del tercero |
| T7 | Login de los 5 roles precargados | 200 en cada uno y `GET /api/v1/auth/me` devuelve el rol correcto |
| T8 | Reinicio de la aplicación | El seeder no duplica usuarios (idempotencia) |

---

## 8. Riesgos y decisiones abiertas

| # | Severidad | Riesgo | Propuesta |
|---|---|---|---|
| R1 | **Alta** | El sembrado de 10 credenciales demo de contraseña conocida no debe llegar a un despliegue real | D3: el seeder nace restringido por perfil y no registra contraseñas en el log |
| R2 | **Media** | No hay motor de migraciones (`pom.xml` sin Flyway/Liquibase). Si un perfil usa `ddl-auto: validate`, el esquema debe existir previamente o el arranque falla | Definir en la tarea 237: `create-drop` en local, `update` en docker, y **decidir explícitamente** qué pasa en producción. Introducir migraciones es una tarea aparte |
| R3 | Baja | "Bloqueo temporal" ya significa el lock del broadcast de C2 en la documentación del proyecto | Nombrar este concepto siempre **"bloqueo por intentos fallidos"** |
| R4 | Media | DoS por bloqueo de cuentas conocidas: cualquiera bloquea a un operador durante 5 minutos a propósito | Fuera del MVP. Mitigación futura: límite por IP + backoff exponencial |
| R5 | Baja | El bloqueo no revoca sesiones activas (D9) | Declarado; no se corrige en el MVP |
| R6 | Media | El tablero tiene historias de "donante" (`EP-03.F3`) y el frontend tiene una vista para el donante, pero el catálogo de roles del proyecto define solo 5, sin `DONANTE` | Confirmar con el equipo si "donante" es un rol de sistema o una persona con rol `CIUDADANO`, **antes** de fijar el catálogo en código |
| R7 | Baja | El frontend excluye `CIUDADANO` del selector de roles y enruta solo conductor vs. sala | El catálogo sí incluye el rol; su pantalla destino es alcance de la tarea 238 |

---

## 9. Trazabilidad con los criterios de aceptación

| Escenario de la historia `EP-01.F1.US2` | Elemento del diseño | Tarea que lo implementa |
|---|---|---|
| **Credenciales correctas** → accedo con los permisos de mi rol | D2 (catálogo), D1 (modelo), D10 (ubicación) | 237 (endpoint) + 238 (redirección) |
| **Credenciales incorrectas** → tras 3 intentos fallidos seguidos, bloqueo de 5 minutos | D5 (regla), D6 (atomicidad), D4 (modelo), D7 (423) | 237 (endpoint) + 239 (pruebas) |
| *"valida las credenciales contra un conjunto fijo de usuarios precargados"* | D1, D2, D3 | 237 |

---

## 10. Entregables de la tarea 236

1. Este documento: modelo, catálogo, regla, contrato y ubicación en la arquitectura.
2. El DDL de §4.1.
3. Los 8 casos de prueba de §7, como insumo de la tarea 239.

**No incluye:** código de producción, pantalla de login ni motor de migraciones.
