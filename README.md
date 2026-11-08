# Nexo Vital — monorepo

Front y back de **Nexo Vital** (sala de operaciones de emergencias / CRUE) juntos en un solo
repositorio, con un launcher que levanta todo en un clic.

**ARWS — Arquitecturas de Software — ECI — 2026-2**


## Arranque en un clic (Windows)

```
run.cmd
```

Doble clic o `.\run.cmd` desde una terminal. El launcher:

1. verifica **Node**, **Java 21** y **Maven**; si falta alguno lo instala con `winget`;
2. instala las dependencias del front (`npm install`) la primera vez;
3. genera un `NEXOVITAL_JWT_SECRET` de desarrollo para esta sesión (no se versiona ninguno; en
   desarrollo el back también lo genera solo si falta, ver la nota de más abajo);
4. levanta el **back** en `http://localhost:8080`;
5. espera a que el back acepte conexiones de verdad (no es un `sleep` a ciegas);
6. levanta el **front** en `http://localhost:5173`;
7. abre el navegador.

Para apagar, cerrá las ventanas **NexoVital back** y **NexoVital front**.

> **Primera corrida:** Maven descarga sus dependencias y `npm install` instala el front. Puede
> tardar varios minutos. Las siguientes son rápidas.
>
> Si el launcher instaló Java/Maven/Node, «cerrá la ventana, abrí una nueva y volvé a ejecutar»:
> `winget` actualiza el PATH, pero no el de la sesión ya abierta.

## Estructura

```
NexoVital/
├─ Front_NexoVital/   React + TS + Vite (SPA, mapa, consola del conductor, CRUE)
├─ Back_NexoVital/    Spring Boot (monolito modular, arquitectura hexagonal)
└─ run.cmd            launcher
```

Cada carpeta conserva **su propia historia y sus propios README**:

- `Front_NexoVital/README.md` — front, modo demo, scripts (`dev`, `dev:mock`, `preview:mock`).
- `Back_NexoVital/README.md` — back, arquitectura, cómo correr tests y evidencias.

## Puertos

| Servicio | Puerto | Notas |
|---|---|---|
| Front (Vite) | `5173` | proxya `/api` → `8080` y `/ws` → `ws://localhost:8080` |
| Back (Spring Boot) | `8080` | perfil `default`: **H2 en memoria** + seed de usuarios demo |

El launcher **avisa** si un puerto está ocupado, pero nunca mata procesos ajenos.

## Arranque manual (si preferís control)

```powershell
# Back (el login local del back arranca apagado: se enciende para desarrollo)
cd Back_NexoVital
$env:NEXOVITAL_AUTH_LOCAL_ENABLED = "true"
mvn spring-boot:run

# Front (en otra terminal)
cd Front_NexoVital
npm install
npm run dev
```

## Autenticación: IdP externo y login local de desarrollo

El producto se autentica con un **proveedor de identidad externo** (Firebase Auth,
ADR-0008). El login por email y contraseña del backend es un recurso de desarrollo y de la
suite, no una función del producto:

- `nexovital.auth.local.enabled` arranca en **`false`** en `application.properties`, y
  `docker` y `prod` lo fijan en `false` otra vez. Con el login apagado,
  `POST /api/v1/sesiones` responde **404**.
- Solo `application-test.properties` lo enciende, porque la suite necesita emitir tokens sin
  Firebase.
- Para levantar el backend en local hay que exportar `NEXOVITAL_AUTH_LOCAL_ENABLED=true`
  (el launcher `run.cmd` ya lo hace). El front usa ese camino **solo en `npm run dev`**: un
  build de producción con Firebase sin configurar falla en voz alta, nunca cae al login local.
- En docker, el front se construye con las variables `VITE_FIREBASE_*` y el backend valida
  ID tokens de Firebase con el JWKS del proyecto.

## Datos y credenciales de desarrollo

- El back usa **H2 en memoria** con `create-drop`: el esquema se recrea en cada arranque.
- Se siembran usuarios demo (`nexovital.seed.enabled=true`), los mismos que ofrece el panel
  «Perfiles demo» del front. Ejemplos: `ciudadano@nexovital.co` / `ciudadano123` y
  `conductor1@nexovital.co` / `conductor123`.
- El secreto JWT se genera por corrida: al reiniciar el back, los tokens previos dejan de valer
  y hay que volver a iniciar sesión. Es intencional: no se commitea ningún secreto.

### Secreto JWT automático en desarrollo (temporal)

Para no tener que exportar `NEXOVITAL_JWT_SECRET` en cada terminal, el back genera un secreto
aleatorio en memoria cuando la variable no está definida y el perfil **no** es `prod`
(`JwtTokenAdapter`). Por eso en local basta con `mvn spring-boot:run`.

**Es una comodidad de desarrollo que se agregó de forma temporal y se debe retirar antes de
salir a producción.** Pendiente para ese momento:

- quitar la generación automática de `JwtTokenAdapter`, de modo que el secreto vuelva a ser
  obligatorio en todos los perfiles y el arranque falle si falta;
- definir `NEXOVITAL_JWT_SECRET` (al menos 32 bytes) en el entorno de despliegue;
- ajustar `JwtSecretoArranqueTest` y esta sección.

Mientras tanto, con el perfil `prod` el secreto ya es obligatorio: sin él el arranque aborta.

## Documentación de la API

Con el perfil de desarrollo, Swagger UI queda disponible en
`http://localhost:8080/swagger-ui.html` (y el JSON en `/v3/api-docs`). En `prod` está apagado.

## Base de datos distribuida (Citus, opcional)

La topología por defecto sigue siendo **un PostgreSQL**. Para levantar la variante con
**escalabilidad horizontal de la base de datos** (coordinador + 2 workers, tablas grandes
distribuidas):

```powershell
.\deploy\citus\levantar.ps1    # levanta el cluster y distribuye las tablas
.\deploy\citus\verificar.ps1   # muestra nodos, shards y planes router/multi-shard
```

La app no cambia: sigue conectándose a `db:5432` (el coordinador). El diseño, el porqué de la
llave de sharding y el paralelo con Uber están en `docs/base-datos-distribuida.md`.

## Origen de este repositorio

Se armó con `git subtree`, así que trae la **historia completa** de cada proyecto
(`Front_NexoVital` desde su rama `main`; `Back_NexoVital` desde `back-evidencia-c2`), no un
snapshot. Los repos originales siguen existiendo por separado.
