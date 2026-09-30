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
3. genera un `NEXOVITAL_JWT_SECRET` de desarrollo para esta sesión (el back **no arranca sin
   secreto** y no se versiona ninguno);
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
# Back
cd Back_NexoVital
$env:NEXOVITAL_JWT_SECRET = [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Max 256 }))
mvn spring-boot:run

# Front (en otra terminal)
cd Front_NexoVital
npm install
npm run dev
```

## Datos y credenciales de desarrollo

- El back usa **H2 en memoria** con `create-drop`: el esquema se recrea en cada arranque.
- Se siembran usuarios demo (`nexovital.seed.enabled=true`), los mismos que ofrece el panel
  «Perfiles demo» del front. Ejemplos: `ciudadano@nexovital.co` / `ciudadano123` y
  `conductor1@nexovital.co` / `conductor123`.
- El secreto JWT se genera por corrida: al reiniciar el back, los tokens previos dejan de valer
  y hay que volver a iniciar sesión. Es intencional: no se commitea ningún secreto.

## Documentación de la API

Con el perfil de desarrollo, Swagger UI queda disponible en
`http://localhost:8080/swagger-ui.html` (y el JSON en `/v3/api-docs`). En `prod` está apagado.

## Origen de este repositorio

Se armó con `git subtree`, así que trae la **historia completa** de cada proyecto
(`Front_NexoVital` desde su rama `main`; `Back_NexoVital` desde `back-evidencia-c2`), no un
snapshot. Los repos originales siguen existiendo por separado.
