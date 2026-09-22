# Nexo Vital — Backend

Backend hexagonal modular de **Nexo Vital** (sala de operaciones de emergencias / CRUE).

**ARWS — Arquitecturas de Software · ECI · 2026-2**

## Estado

**Scaffolding.** Este repositorio contiene únicamente la estructura de paquetes de la
arquitectura hexagonal. Los módulos están vacíos: la implementación se desarrolla durante
el sprint del corte.

## Stack

| | |
|---|---|
| Java | 21 |
| Spring Boot | 3.5.16 |
| Persistencia | JPA (H2 en local, PostgreSQL en despliegue) |
| Mensajería | AMQP (RabbitMQ) |
| Tiempo real | WebSocket / STOMP |
| Seguridad | Spring Security + JWT |

## Arquitectura

Monolito modular con arquitectura hexagonal por módulo. Ver
`docs/adr/0003-monolito-modular-hexagonal.md` en el repositorio de documentación.

Cada módulo repite la misma estructura:

```
<modulo>/
├── domain/
│   ├── model/          Entidades y objetos de valor (sin dependencias de framework)
│   ├── port/
│   │   ├── in/         Casos de uso (interfaces que expone el dominio)
│   │   └── out/        Puertos de salida (repositorios, publicadores de eventos)
│   └── ...
├── application/
│   └── usecase/        Implementación de los casos de uso
└── infrastructure/
    └── adapter/
        ├── in/         Adaptadores de entrada (controladores REST, consumidores)
        └── out/        Adaptadores de salida (JPA, AMQP, STOMP)
```

### Módulos

| Módulo | Responsabilidad |
|---|---|
| `usuarios` | Registro, autenticación y organizaciones |
| `mapa` | Zonas afectadas, centros y puntos de entrega |
| `recursos` | Inventario, solicitudes, donaciones y semáforo |
| `flota` | Ambulancias, posiciones y asignación por broadcast |
| `observabilidad` | Bitácora de eventos y KPIs |
| `gateway` | Puente de eventos hacia los canales de tiempo real |
| `shared` | Tipos y contratos compartidos entre módulos |
| `infrastructure` | Configuración transversal (seguridad, mensajería, datos) |

## Reglas de arquitectura

- **El servidor es la única fuente de verdad.** Ninguna decisión de asignación se resuelve en el cliente.
- **Los invariantes se garantizan por construcción**, con operaciones atómicas en base de datos. Nunca con bloqueos en memoria ni banderas en el cliente.
- **El disparador de un evento es el servicio que ejecuta la transacción**, nunca el frontend.
- El dominio no depende de Spring ni de JPA. Las dependencias apuntan hacia adentro.

## Requisitos

- JDK 21
- Maven 3.9+

## Configuración: secreto JWT

La aplicación **no arranca sin `NEXOVITAL_JWT_SECRET`**. No existe un valor por defecto a
propósito: un secreto comiteado en el repositorio permitiría forjar tokens a cualquiera con
acceso al código. La clave debe medir **al menos 32 bytes** (HS256); si falta o es más corta,
el arranque falla con un mensaje que explica cómo generarla.

```powershell
# PowerShell
$env:NEXOVITAL_JWT_SECRET = (openssl rand -base64 32)
```

```bash
# bash
export NEXOVITAL_JWT_SECRET=$(openssl rand -base64 32)
```

## Ejecución

```bash
mvn spring-boot:run
```

Perfil por defecto: H2 en memoria con `spring.jpa.hibernate.ddl-auto=create-drop`. La decisión
de esquema por perfil (`create-drop` local, `update` docker, `validate` prod) y lo que producción
necesita están documentados en `src/main/resources/application.properties`.

## Usuarios de demostración

`DataSeeder` siembra 10 usuarios que cubren los 5 roles. Solo se activa con los perfiles
`default`, `docker` o `test`, y además exige `nexovital.seed.enabled=true`: **nunca corre en
producción**. Es idempotente, así que reiniciar no duplica cuentas. Las contraseñas se persisten
únicamente como hash BCrypt y nunca se escriben en el log.

| Rol | Email | Contraseña |
|---|---|---|
| `ADMIN_CENTRO_AYUDA` | `rangel@nexovital.co` | `rangel123` |
| `ADMIN_PLATAFORMA` | `admin@nexovital.co` | `admin123` |
| `ADMIN_CENTRO_AYUDA` | `centro@nexovital.co` | `centro123` |
| `ADMIN_ACOPIO` | `acopio@nexovital.co` | `acopio123` |
| `CIUDADANO` | `ciudadano@nexovital.co` | `ciudadano123` |
| `CONDUCTOR` | `conductor1@nexovital.co` … `conductor5@nexovital.co` | `conductor123` |

## API de sesiones

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/v1/sesiones` | Crea una sesión. `200` con `{token, usuario}`; `401` `CREDENCIALES_INVALIDAS`; `423` `CUENTA_BLOQUEADA` + cabecera `Retry-After` (segundos restantes) |
| `GET` | `/api/v1/sesiones/actual` | Usuario de la sesión vigente, resuelto desde el Bearer token. `401` sin token válido |

Tras **3 intentos fallidos seguidos** la cuenta queda bloqueada **5 minutos**. Durante el bloqueo
la contraseña no se evalúa y el contador no se incrementa, de modo que la ventana siempre expira.

## Pruebas

```bash
mvn test
```
