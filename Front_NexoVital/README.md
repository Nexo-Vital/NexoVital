# Nexo Vital — Frontend (React + TypeScript + Vite)

Scaffold inicial del frontend de la sala de operaciones CRUE. Creado a mano
(no con `npm create vite`): en la máquina de bootstrap no había Node disponible.

## Stack

- React 18 + TypeScript 5
- Vite 5 (dev server + build)
- React Router 6 (rutas por rol)
- @stomp/stompjs + sockjs-client (WebSocket/STOMP con fallback y reconexión)
- Vitest (tests, pendientes de escribir)

## Estructura

```
frontend/
├── src/
│   ├── components/   # Mapa, PanelFlota, PopupSolicitud, Inventario, Dashboard, Login
│   ├── services/     # apiClient.ts (fetch /api/v1) y stompClient.ts (/ws)
│   ├── types/        # domain.ts — mirror de contract/openapi.yaml
│   ├── App.tsx       # rutas: /login, /, /flota, /inventario, /dashboard, /solicitudes
│   └── main.tsx
├── vite.config.ts    # proxy dev: /api → :8080, /ws → ws://localhost:8080
├── package.json
├── tsconfig.json / tsconfig.node.json
└── index.html
```

## Correr en dev

```bash
npm install
npm run dev
```

El proxy de Vite (`/api` → `http://localhost:8080`, `/ws` → `ws://localhost:8080`)
**elimina el CORS en desarrollo**: el navegador solo habla con el dev server, y
el dev server reenvía al backend. No hace falta configurar CORS en Spring Boot
para el dev local.

## Build y tests

```bash
npm run build   # tsc && vite build → dist/
npm run test    # Vitest
```

Los tests **no están escritos todavía**: `npm run test` fallaría en este estado
(no hay archivos de test). Se incorporan junto con la suite de componentes.

## Notas

- **Login mock**: el acceso es local y hardcodeado — solo entra el usuario
  `rangel` (case-insensitive, sin backend). La sesión se guarda en
  `localStorage` bajo `nexovital.session` con rol `ADMIN_CENTRO_AYUDA`.
  Las rutas protegidas (`/`, `/flota`, `/inventario`, `/dashboard`,
  `/solicitudes`) redirigen a `/login` sin sesión.
- `src/services/stompClient.ts` es una plantilla funcional comentada: conexión a
  `/ws` con SockJS, heartbeat 10 s y reconexión automática cada 5 s.
  Sustituir el header JWT real cuando exista autenticación.
- Los types de `src/types/domain.ts` son el MIRROR del contrato
  `contract/openapi.yaml`: cualquier cambio de contrato debe reflejarse acá.
- Sin `node_modules` versionados: correr `npm install` tras clonar.